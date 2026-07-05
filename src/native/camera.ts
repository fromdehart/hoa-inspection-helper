import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { isNative } from "./platform";

async function webPathToFile(
  webPath: string | undefined,
  format: string,
  name: string,
): Promise<File> {
  if (!webPath) throw new Error("Camera returned no image path");
  const res = await fetch(webPath);
  const blob = await res.blob();
  const type = blob.type || `image/${format || "jpeg"}`;
  return new File([blob], name, { type });
}

/** True when native camera capture is available (iOS/Android shell). */
export function hasNativeCamera(): boolean {
  return isNative();
}

/** Take a single photo with the device camera. Native only. */
export async function takePhoto(): Promise<File> {
  const photo = await Camera.getPhoto({
    quality: 90,
    allowEditing: false,
    resultType: CameraResultType.Uri,
    source: CameraSource.Camera,
    saveToGallery: false,
  });
  return webPathToFile(photo.webPath, photo.format, `capture-${Date.now()}.${photo.format || "jpg"}`);
}

/** Pick one or more photos from the gallery. Native only. */
export async function pickPhotos(limit = 10): Promise<File[]> {
  const result = await Camera.pickImages({ quality: 90, limit });
  const files: File[] = [];
  for (const [i, p] of result.photos.entries()) {
    files.push(
      await webPathToFile(p.webPath, p.format, `pick-${Date.now()}-${i}.${p.format || "jpg"}`),
    );
  }
  return files;
}
