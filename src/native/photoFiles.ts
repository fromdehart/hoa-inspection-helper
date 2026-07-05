import { Filesystem, Directory } from "@capacitor/filesystem";
import { isNative } from "./platform";
import { db } from "../offline/db";

const DIR = Directory.Data;
const SUBDIR = "outbox-photos";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result as string;
      // strip the "data:...;base64," prefix
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * Persist captured image bytes locally so an upload can be retried after an app
 * restart / reconnect. Returns a stable ref stored in the outbox row.
 * Native → Capacitor Filesystem; web → IndexedDB blob (Dexie).
 */
export async function savePhotoFile(ref: string, file: Blob): Promise<void> {
  if (isNative()) {
    const base64 = await blobToBase64(file);
    await Filesystem.writeFile({
      path: `${SUBDIR}/${ref}`,
      data: base64,
      directory: DIR,
      recursive: true,
    });
  } else {
    await db.photoBlobs.put({ ref, blob: file });
  }
}

/** Read a persisted photo back as a File for upload. Throws if missing. */
export async function readPhotoFile(ref: string, fileName: string): Promise<File> {
  if (isNative()) {
    const res = await Filesystem.readFile({ path: `${SUBDIR}/${ref}`, directory: DIR });
    const data = typeof res.data === "string" ? res.data : await (res.data as Blob).text();
    const blob = base64ToBlob(data, "image/jpeg");
    return new File([blob], fileName, { type: "image/jpeg" });
  }
  const row = await db.photoBlobs.get(ref);
  if (!row) throw new Error(`Local photo not found: ${ref}`);
  return new File([row.blob], fileName, { type: row.blob.type || "image/jpeg" });
}

export async function deletePhotoFile(ref: string): Promise<void> {
  try {
    if (isNative()) {
      await Filesystem.deleteFile({ path: `${SUBDIR}/${ref}`, directory: DIR });
    } else {
      await db.photoBlobs.delete(ref);
    }
  } catch {
    // Already gone — fine.
  }
}
