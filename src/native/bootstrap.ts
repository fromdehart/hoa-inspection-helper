import { App as CapApp } from "@capacitor/app";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";
import { Browser } from "@capacitor/browser";
import { isNative } from "./platform";

let initialized = false;

/**
 * One-time native shell setup: status bar, splash screen, and deep-link routing.
 * No-op on web. Safe to call from a React effect at app startup.
 */
export function initNativeShell(): void {
  if (initialized || !isNative()) return;
  initialized = true;

  // Dark app chrome to match the brand header.
  void StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  void SplashScreen.hide().catch(() => {});

  // Route incoming deep links (e.g. the emailed /portal/:token letter link) into
  // the SPA without a full reload. Full Universal/App Links still require the
  // domain association files + signing (see the runbook).
  void CapApp.addListener("appUrlOpen", ({ url }) => {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname + parsed.search + parsed.hash;
      if (path && path !== "/") {
        window.history.pushState({}, "", path);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    } catch {
      // Not a routable URL — ignore.
    }
  });
}

/** Open an external URL in the system browser instead of hijacking the app webview. */
export async function openExternal(url: string): Promise<void> {
  if (isNative()) {
    await Browser.open({ url });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
