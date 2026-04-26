const BASE = import.meta.env.VITE_UPLOAD_SERVER_URL ?? "http://localhost:3001";

export async function uploadPhoto(file: File, propertyId: string, section: string) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("propertyId", propertyId);
  fd.append("section", section);
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/upload`, { method: "POST", body: fd });
  } catch {
    throw new Error(`Upload server not reachable at ${BASE}. Start it with: npm run dev:upload`);
  }
  if (!res.ok) throw new Error("Upload failed: " + res.status);
  return res.json() as Promise<{ publicUrl: string; filePath: string }>;
}

export async function uploadTemplateFile(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("propertyId", "template");
  fd.append("section", "letters");
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/upload`, { method: "POST", body: fd });
  } catch {
    throw new Error(`Upload server not reachable at ${BASE}. Start it with: npm run dev:upload`);
  }
  if (!res.ok) throw new Error("Template upload failed: " + res.status);
  return res.json() as Promise<{ publicUrl: string; filePath: string }>;
}
