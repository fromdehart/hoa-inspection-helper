import { Capacitor } from "@capacitor/core";

/** True when running inside the Capacitor native shell (iOS/Android), not a browser. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** "ios" | "android" | "web" */
export function getPlatform(): string {
  return Capacitor.getPlatform();
}

export function isIOS(): boolean {
  return getPlatform() === "ios";
}

export function isAndroid(): boolean {
  return getPlatform() === "android";
}
