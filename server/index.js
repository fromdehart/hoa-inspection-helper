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

// Use flat temp destination; we'll move the file after we know propertyId/section
const upload = multer({ dest: path.join(UPLOADS_DIR, "_tmp") });

app.use("/uploads", express.static(UPLOADS_DIR));

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
