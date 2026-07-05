import { SpeechRecognition } from "@capacitor-community/speech-recognition";
import { isNative } from "./platform";

/** Native on-device dictation is available in the iOS/Android shell (not the web app). */
export function isNativeSpeechAvailable(): boolean {
  return isNative();
}

/**
 * Start native dictation. `onText` receives the running transcript for the current
 * session (cumulative, not incremental) — the caller replaces its field text with
 * base + transcript so there is no duplication. `onEnd` fires when listening stops.
 * Returns false if permission was denied or speech isn't available.
 */
export async function startDictation(
  onText: (text: string) => void,
  onEnd?: () => void,
): Promise<boolean> {
  try {
    const perm = await SpeechRecognition.requestPermissions();
    if (perm.speechRecognition !== "granted") return false;
  } catch {
    return false;
  }
  try {
    const a = await SpeechRecognition.available();
    if (!a.available) return false;
  } catch {
    // Some platforms don't implement available(); proceed and let start() throw.
  }

  await SpeechRecognition.removeAllListeners();
  await SpeechRecognition.addListener("partialResults", (data: { matches?: string[] }) => {
    const best = data.matches?.[0];
    if (best) onText(best);
  });
  if (onEnd) {
    await SpeechRecognition.addListener("listeningState", (data: { status?: string }) => {
      if (data.status === "stopped") onEnd();
    });
  }

  await SpeechRecognition.start({ language: "en-US", partialResults: true, popup: false });
  return true;
}

export async function stopDictation(): Promise<void> {
  try {
    await SpeechRecognition.stop();
  } catch {
    /* not started / already stopped */
  }
  try {
    await SpeechRecognition.removeAllListeners();
  } catch {
    /* ignore */
  }
}
