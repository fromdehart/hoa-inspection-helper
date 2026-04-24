import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT ?? 3001;
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const UPLOADS_DIR =
  process.env.UPLOADS_DIR ?? path.resolve(__dirname, "../uploads");

// Ensure uploads dir exists
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGIN ?? "*" }));
app.use(express.json({ limit: "32kb" }));

// Use flat temp destination; we'll move the file after we know propertyId/section
const upload = multer({ dest: path.join(UPLOADS_DIR, "_tmp") });

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

/** Authenticated delete for inspector “wrong photo” flow; same token as VITE_UPLOAD_DELETE_TOKEN on the client. */
app.post("/api/delete-file", (req, res) => {
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

    if (!fs.existsSync(abs)) {
      return res.status(204).end();
    }

    fs.unlinkSync(abs);
    return res.status(204).end();
  } catch (err) {
    console.error("Delete-file error:", err);
    return res.status(500).json({ error: "Delete failed" });
  }
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const propertyId = (req.body.propertyId ?? "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
    const section = (req.body.section ?? "general").replace(/[^a-zA-Z0-9_-]/g, "_");
    const ext = path.extname(req.file.originalname) || ".jpg";
    const filename = `${Date.now()}_${req.file.filename}${ext}`;

    const destDir = path.join(UPLOADS_DIR, propertyId, section);
    fs.mkdirSync(destDir, { recursive: true });

    const destPath = path.join(destDir, filename);
    fs.renameSync(req.file.path, destPath);

    const filePath = `${propertyId}/${section}/${filename}`;
    const publicUrl = `${BASE_URL}/uploads/${filePath}`;

    return res.json({ publicUrl, filePath });
  } catch (err) {
    console.error("Upload error:", err);
    return res.status(500).json({ error: "Upload failed" });
  }
});

app.listen(PORT, () => {
  console.log(`HOA upload server running on port ${PORT}`);
  console.log(`Uploads directory: ${UPLOADS_DIR}`);
  console.log(`Base URL: ${BASE_URL}`);
});
