const BASE = import.meta.env.VITE_UPLOAD_SERVER_URL ?? "http://localhost:3001";

export async function uploadPhoto(file: File, propertyId: string, section: string) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("propertyId", propertyId);
  fd.append("section", section);
  const res = await fetch(`${BASE}/api/upload`, { method: "POST", body: fd });
  if (!res.ok) throw new Error("Upload failed: " + res.status);
  return res.json() as Promise<{ publicUrl: string; filePath: string }>;
}

/**
 * Removes the blob on the upload VPS after Convex `photos.remove`.
 * Requires matching `UPLOAD_DELETE_TOKEN` on the server and `VITE_UPLOAD_DELETE_TOKEN` in the client env.
 * If the client token is unset, logs a warning and returns (DB row should still be removed first).
 */
export async function deleteUploadedFile(filePath: string): Promise<void> {
  const token = import.meta.env.VITE_UPLOAD_DELETE_TOKEN as string | undefined;
  if (!token) {
    console.warn(
      "[upload] VITE_UPLOAD_DELETE_TOKEN is not set; skipping server file delete (orphan file may remain).",
    );
    return;
  }
  const res = await fetch(`${BASE}/api/delete-file`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Upload-Delete-Token": token,
    },
    body: JSON.stringify({ filePath }),
  });
  if (res.status === 401 || res.status === 503) {
    throw new Error(`Upload server refused delete (${res.status})`);
  }
  if (!res.ok && res.status !== 204) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Delete failed: ${res.status} ${msg}`.trim());
  }
}
