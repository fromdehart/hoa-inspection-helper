import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  /** Ensures SPA fallback + routing match Vercel’s Vite SPA guidance */
  appType: "spa",
  base: "/",
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  /** Same host/port as dev so `npm run local:vercel` matches production styling at localhost:8080 */
  preview: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    /**
     * PWA: precaches the built SPA shell only. We intentionally avoid runtime caching rules for
     * Clerk, Convex, or upload hosts so auth and live data are never served stale from a SW.
     */
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      devOptions: {
        enabled: false,
      },
      includeAssets: [
        "favicon.svg",
        "favicon.ico",
        "robots.txt",
        "icons/apple-touch-icon.png",
        "icons/pwa-192x192.png",
        "icons/pwa-512x512.png",
        "icons/pwa-512x512-maskable.png",
      ],
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,svg,png,woff2}"],
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
      },
      manifest: {
        name: "Happier Block",
        short_name: "Happier Block",
        description:
          "HOA exterior inspections: import properties, capture photos on-site, generate letters.",
        theme_color: "#1e1b4b",
        background_color: "#1e1b4b",
        display: "standalone",
        scope: "/",
        start_url: "/",
        orientation: "portrait-primary",
        icons: [
          {
            src: "/icons/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/pwa-512x512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    // Enable compression and minification
    minify: "terser",
    terserOptions: {
      compress: {
        // Keep console.* so [hoa-auth] logs work on Vercel when debugging Clerk/roles
        drop_console: false,
        drop_debugger: true,
      },
    },
    // Optimize chunk size
    chunkSizeWarningLimit: 1000,
  },
});
