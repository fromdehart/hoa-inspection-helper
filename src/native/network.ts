import { Network } from "@capacitor/network";
import { isNative } from "./platform";

type Listener = (online: boolean) => void;

const listeners = new Set<Listener>();
let currentOnline = typeof navigator === "undefined" ? true : navigator.onLine;
let initialized = false;

function emit(online: boolean) {
  if (online === currentOnline) return;
  currentOnline = online;
  for (const l of listeners) l(online);
}

/** Idempotently wire up native (Capacitor Network) + web (navigator.onLine) listeners. */
export function initNetwork(): void {
  if (initialized) return;
  initialized = true;

  if (isNative()) {
    void Network.getStatus().then((s) => emit(s.connected));
    void Network.addListener("networkStatusChange", (s) => emit(s.connected));
  } else if (typeof window !== "undefined") {
    currentOnline = navigator.onLine;
    window.addEventListener("online", () => emit(true));
    window.addEventListener("offline", () => emit(false));
  }
}

export function isOnline(): boolean {
  return currentOnline;
}

/** Subscribe to connectivity changes. Returns an unsubscribe function. */
export function onNetworkChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
