const BASE = import.meta.env.VITE_UPLOAD_SERVER_URL ?? "http://localhost:3001";
const UPLOAD_TOKEN = import.meta.env.VITE_UPLOAD_TOKEN as string | undefined;

async function uploadToSection(propertyId: string, section: string, file: File) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("propertyId", propertyId);
  fd.append("section", section);
  const headers: Record<string, string> = {};
  if (UPLOAD_TOKEN) headers["X-Upload-Token"] = UPLOAD_TOKEN;
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/upload`, { method: "POST", body: fd, headers });
  } catch {
    throw new Error(`Upload server not reachable at ${BASE}. Start it with: npm run dev:upload`);
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      /* ignore non-JSON error bodies */
    }
    throw new Error(detail ? `Upload failed: ${detail}` : `Upload failed: ${res.status}`);
  }
  return res.json() as Promise<{ publicUrl: string; filePath: string }>;
}

export async function uploadPhoto(file: File, propertyId: string, section: string) {
  return uploadToSection(propertyId, section, file);
}

export async function uploadTemplateFile(file: File) {
  return uploadToSection("template", "letters", file);
}

/** HOA-level ARC rules / examples (stored under uploads/hoa-ref/arc-rules/). */
export async function uploadArcReferenceFile(file: File) {
  return uploadToSection("hoa-ref", "arc-rules", file);
}

/** Per-property ARC application attachments. */
export async function uploadArcApplicationFile(propertyId: string, file: File) {
  return uploadToSection(propertyId, "arc-application", file);
}
