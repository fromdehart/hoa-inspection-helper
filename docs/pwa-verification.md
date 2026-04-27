# PWA verification (Happier Block)

Automated check: `npm run build` completes and emits `dist/sw.js`, `dist/manifest.webmanifest`, and `dist/registerSW.js`.

## Android (Chrome)

1. Deploy or run `npm run preview` over HTTPS (install prompts require a secure context).
2. Open the site, wait for the service worker to register (reload once if needed).
3. Confirm **Install app** appears on the marketing home when Chrome fires `beforeinstallprompt`, or use the browser menu **Install app**.
4. Launch the installed shortcut: app opens in **standalone** (minimal browser chrome).
5. Sign in with Clerk, open **Admin** and **Inspector** flows, and confirm Convex data loads.
6. Optional: turn on airplane mode after a successful visit; confirm the shell still loads (live data will still need network).

## iOS (Safari)

1. Open the site in Safari.
2. Use **Share → Add to Home Screen**.
3. Open from the home screen icon; confirm title and icon look correct.
4. Run through sign-in and inspector photo capture if you use uploads (same-origin cookies should behave like Safari).

## Updates

After a new deploy, reload the installed PWA; with `registerType: "autoUpdate"`, the new service worker should activate on the next navigation or refresh.
