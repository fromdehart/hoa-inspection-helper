/**
 * Generates PWA / Apple touch PNGs from public/favicon.svg (requires sharp).
 * Run: npm run pwa:icons
 */
import sharp from "sharp";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const svgPath = join(root, "public/favicon.svg");
const outDir = join(root, "public/icons");

mkdirSync(outDir, { recursive: true });
const input = readFileSync(svgPath);

const sizes = [
  { size: 180, file: "apple-touch-icon.png" },
  { size: 192, file: "pwa-192x192.png" },
  { size: 512, file: "pwa-512x512.png" },
];

for (const { size, file } of sizes) {
  await sharp(input).resize(size, size).png().toFile(join(outDir, file));
}

// Maskable: icon on safe-area background (padding) for Android adaptive icons
const inner = 384;
const pad = (512 - inner) / 2;
await sharp(input)
  .resize(inner, inner)
  .extend({ top: pad, bottom: pad, left: pad, right: pad, background: "#1e1b4b" })
  .png()
  .toFile(join(outDir, "pwa-512x512-maskable.png"));

console.log("Wrote PWA icons to public/icons/");
