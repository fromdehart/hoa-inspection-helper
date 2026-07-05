import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT ?? 3001;
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const UPLOADS_DIR =
  process.env.UPLOADS_DIR ?? path.resolve(__dirname, "../uploads");

// Max upload size (default 25MB — generous for phone photos and PDF/DOCX docs).
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024);
// Optional shared secret. When set, /api/upload requires header X-Upload-Token.
const UPLOAD_TOKEN = process.env.UPLOAD_TOKEN;

// This server receives BOTH homeowner/inspector photos AND admin template/ARC docs,
// so the allowlist must cover images plus PDF/DOCX.
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".pdf", ".docx"]);
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream", // some browsers send this for HEIC
]);

// Ensure uploads dir exists (startup only — fine to be sync).
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGIN ?? "*" }));
app.use(express.json({ limit: "32kb" }));

// Use flat temp destination; we'll move the file after we know propertyId/section.
const upload = multer({
  dest: path.join(UPLOADS_DIR, "_tmp"),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.has(ext) && ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.originalname} (${file.mimetype})`));
    }
  },
});

app.use("/uploads", express.static(UPLOADS_DIR));

/**
 * Resolve `filePath` (e.g. propertyId/front/123_abc.png) to an absolute path under UPLOADS_DIR, or null if unsafe.
 */
function resolveUploadFilePath(rel) {
  if (typeof rel !== "string" || rel.length === 0 || rel.length > 512) return null;
  const trimmed = rel.replace(/^[/\\]+/, "");
  const resolvedBase = path.resolve(UPLOADS_DIR);
  const resolvedFile = path.resolve(resolvedBase, trimmed);
  const relToBase = path.relative(resolvedBase, resolvedFile);
  if (relToBase.startsWith("..") || path.isAbsolute(relToBase)) return null;
  return resolvedFile;
}

/** Authenticated delete for inspector “wrong photo” flow; token held server-side (UPLOAD_DELETE_TOKEN). */
app.post("/api/delete-file", async (req, res) => {
  try {
    const expected = process.env.UPLOAD_DELETE_TOKEN;
    if (!expected) {
      return res.status(503).json({ error: "Delete not configured (missing UPLOAD_DELETE_TOKEN)" });
    }
    const token = req.get("X-Upload-Delete-Token");
    if (token !== expected) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const rel = req.body?.filePath;
    const abs = resolveUploadFilePath(rel);
    if (!abs) {
      return res.status(400).json({ error: "Invalid file path" });
    }

    try {
      await fsp.unlink(abs);
    } catch (e) {
      if (e && e.code === "ENOENT") return res.status(204).end();
      throw e;
    }
    return res.status(204).end();
  } catch (err) {
    console.error("Delete-file error:", err);
    return res.status(500).json({ error: "Delete failed" });
  }
});

app.post("/api/upload", (req, res) => {
  // Optional shared-secret gate (enforced only when UPLOAD_TOKEN is configured).
  if (UPLOAD_TOKEN && req.get("X-Upload-Token") !== UPLOAD_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  upload.single("file")(req, res, async (uploadErr) => {
    if (uploadErr) {
      const tooBig = uploadErr.code === "LIMIT_FILE_SIZE";
      console.error("Upload rejected:", uploadErr.message);
      return res
        .status(tooBig ? 413 : 400)
        .json({ error: tooBig ? `File exceeds ${MAX_UPLOAD_BYTES} bytes` : uploadErr.message });
    }
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const propertyId = (req.body.propertyId ?? "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
      const section = (req.body.section ?? "general").replace(/[^a-zA-Z0-9_-]/g, "_");
      const ext = path.extname(req.file.originalname) || ".jpg";
      const filename = `${Date.now()}_${req.file.filename}${ext}`;

      const destDir = path.join(UPLOADS_DIR, propertyId, section);
      await fsp.mkdir(destDir, { recursive: true });

      const destPath = path.join(destDir, filename);
      await fsp.rename(req.file.path, destPath);

      const filePath = `${propertyId}/${section}/${filename}`;
      const publicUrl = `${BASE_URL}/uploads/${filePath}`;

      return res.json({ publicUrl, filePath });
    } catch (err) {
      console.error("Upload error:", err);
      return res.status(500).json({ error: "Upload failed" });
    }
  });
});

app.listen(PORT, () => {
  console.log(`HOA upload server running on port ${PORT}`);
  console.log(`Uploads directory: ${UPLOADS_DIR}`);
  console.log(`Base URL: ${BASE_URL}`);
});
