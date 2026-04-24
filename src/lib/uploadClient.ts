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
