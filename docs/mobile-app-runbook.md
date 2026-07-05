# Mobile App Runbook (iOS + Android via Capacitor)

This is the morning handoff for finishing the native build. The app code, Capacitor
integration, and the offline engine are all done and verified at the web-build level
on the `mobile-app` branch. The steps below are the parts that need a Mac with native
tooling + your Apple Developer account — they can't be automated in a headless env.

Bundle id: **`com.happierblock.app`** · App name: **Happier Block**

---

## 0. Toolchain status — ALREADY SET UP on this machine ✅

Both platforms have been generated and **verified building** here:
- **Android** debug APK built (`android/app/build/outputs/apk/debug/app-debug.apk`).
- **iOS** simulator build **SUCCEEDED** (Xcode 27 beta).

Installed + configured (in `~/.zshrc`): CocoaPods, **OpenJDK 21** (Capacitor 8 needs 21,
not 17), the Android SDK (platform-tools, build-tools 35, platform android-35) at
`~/Library/Android/sdk`, and `DEVELOPER_DIR` pointing at **`/Applications/Xcode-beta.app`**
(Xcode 27 beta — its license is accepted; the stable Xcode 26.6's license was not, so
the beta is the active CLI toolchain). Open a **new terminal** so these env vars load.

Notes:
- **iOS uses Swift Package Manager**, not CocoaPods — Capacitor 8 writes `Package.swift`;
  there is no `pod install` step. (CocoaPods is installed but unused.)
- Still yours: an **Apple Developer account** (done) for real-device signing / App Store,
  and optionally **Android Studio** for an emulator (CLI device installs work via `adb`).

---

## 1. Environment values (baked into the build)

Native builds bake env in at compile time — a phone can't reach your dev-machine
`localhost`, so every URL must be a real public https host.

Copy `.env.mobile.example` → `.env.production` (the mobile build uses production mode) and fill in:

```
VITE_CONVEX_URL=https://<your-deployment>.convex.cloud
VITE_CLERK_PUBLISHABLE_KEY=pk_live_or_test_...
VITE_UPLOAD_SERVER_URL=https://uploads.happierblock.com   # NOT localhost:3001
VITE_UPLOAD_TOKEN=<same as UPLOAD_TOKEN on the VPS, if you enable it>
```

## 2. Dashboard / server config (one-time)

- **Clerk dashboard**: add allowed origins `capacitor://localhost`, `http://localhost`,
  `https://localhost`. Ensure sign-ups are enabled (homeowners self-register).
- **Upload VPS** (`server/index.js`): set `ALLOWED_ORIGIN` to your web origin
  (e.g. `https://happierblock.com`); the native origins are allowed automatically by
  the new CORS logic. Optionally set `UPLOAD_TOKEN` (must match `VITE_UPLOAD_TOKEN`).
- **Convex**: no origin allowlist needed for the client; just confirm the deployment URL.

## 3. Build (platforms already added + committed)

`ios/` and `android/` are already generated and committed, so you don't need
`cap add`. After any web-code change, re-sync into the native projects:

```bash
npm run build:mobile   # CAPACITOR=1 vite build && cap sync  (SW disabled for native)
```

`build:mobile` produces `dist/` with **no service worker** (a SW conflicts with
Capacitor's asset serving) and copies it into the native projects.

Quick CLI sanity builds (no signing needed):

```bash
# Android debug APK
(cd android && ./gradlew assembleDebug)
# iOS simulator build
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -sdk iphonesimulator -configuration Debug \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

## 4. Native permissions (required for the camera)

**iOS** — add to `ios/App/App/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Take photos of property conditions and completed fixes.</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>Attach existing photos to inspections and requests.</string>
<key>NSPhotoLibraryAddUsageDescription</key>
<string>Save captured inspection photos.</string>
```

**Android** — `android/app/src/main/AndroidManifest.xml` already gets camera support via
the plugin; confirm `<uses-permission android:name="android.permission.CAMERA"/>` and
that `INTERNET` is present (it is by default).

## 5. App icon + splash (optional but recommended)

```bash
npm i -D @capacitor/assets
# place a 1024x1024 icon.png and a 2732x2732 splash.png in ./resources/
npx capacitor-assets generate
```

(Source art can start from `public/icons/pwa-512x512.png`.)

## 6. Open, sign, run

```bash
npm run mobile:ios       # opens Xcode
npm run mobile:android   # opens Android Studio
```

- **iOS**: select the `App` target → Signing & Capabilities → pick your Team; the
  bundle id is `com.happierblock.app`. Choose a simulator or a plugged-in device → Run.
- **Android**: pick an emulator/device → Run. For a shareable build,
  Build → Generate Signed Bundle/APK.

## 7. Test the offline inspector flow (the important one)

1. Sign in as an inspector while **online** and open a street (this caches the
   assigned streets/properties locally).
2. Turn on **Airplane mode**.
3. Open a property, type inspector notes, and **take several photos**. The bottom
   pill shows "Offline — N changes queued". Notes save locally; photos persist to
   device storage.
4. Navigate between cached streets/properties — still works offline.
5. Turn Airplane mode **off**. The pill shows "Syncing… → " and the queue drains:
   notes flush to Convex, photos upload (thumbnail-first + full) and appear in the
   property. Confirm the counts return to zero and nothing was lost.

Also sanity-check: homeowner fix-photo upload (queues + syncs), homeowner ARC photo
attach (native gallery), and admin screens render in the app.

---

## What was done vs. deferred

**Done + web-verified:** Capacitor wrap, offline cache + outbox + sync engine
(inspector notes & photos, homeowner fix photos), native camera/filesystem/network
bridges with web fallbacks, self-hosted fonts, native-origin auth redirect, upload
server CORS, status bar / splash / deep-link scaffold.

**Deferred (needs your domain + signing):**
- **Universal Links / App Links** so emailed `https://happierblock.com/portal/:token`
  letters open the app directly. The in-app `appUrlOpen` router is already wired; you
  still need the `apple-app-site-association` + Android `assetlinks.json` files hosted
  on the domain and the associated-domains entitlement. Until then, letter links open
  in the mobile browser (which still works).
- **Push notifications** (`@capacitor/push-notifications` + APNs/FCM) — not included.
- **External help links** in `ConvexAuthHelp` still open in the webview; wrap them with
  `openExternal()` (`src/native/bootstrap.ts`) if desired.

## Troubleshooting

- **Blank screen on device**: almost always a baked env value pointing at `localhost`.
  Re-check `.env.production`, rerun `npm run build:mobile`.
- **Uploads fail from device**: the VPS didn't allow the native origin, or
  `VITE_UPLOAD_SERVER_URL` is wrong. Check the server CORS + the env URL.
- **Auth redirect loops**: add the three native origins to Clerk allowed origins.
- **Deep-reload 404 in the webview**: if `BrowserRouter` misbehaves on a sub-path
  reload, switch `src/App.tsx` to `HashRouter` (drop-in) — Capacitor serves from the
  root so hash routing is the safe fallback.
