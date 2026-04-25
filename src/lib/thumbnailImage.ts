/**
 * Downscale an image in-browser for a fast first upload (inspector strip / lists).
 * Falls back via thrown errors so callers can upload the original only.
 */
export async function buildInspectorThumbnailJpeg(file: File, maxEdge = 640, quality = 0.82): Promise<File> {
  const bmp = await createImageBitmap(file);
  try {
    const w = bmp.width;
    const h = bmp.height;
    if (w < 1 || h < 1) throw new Error("Invalid image dimensions");
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2d context");
    ctx.drawImage(bmp, 0, 0, tw, th);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error("toBlob failed"));
        },
        "image/jpeg",
        quality,
      );
    });
    return new File([blob], "inspector-thumb.jpg", { type: "image/jpeg" });
  } finally {
    bmp.close();
  }
}
