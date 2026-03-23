// Upload a photo directly to Convex file storage (no separate server needed)
export async function uploadToConvex(file: File, uploadUrl: string): Promise<string> {
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!res.ok) throw new Error("Upload failed: " + res.status);
  const { storageId } = await res.json();
  return storageId as string;
}
