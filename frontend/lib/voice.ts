// Voice in and out using the browser's own speech features (no extra service or key).
// Speech-to-text: Chrome and Edge (Chrome sends the audio to Google to transcribe it).
// Text-to-speech: most browsers; voices for Hindi and Kannada depend on the device.

export const VOICE_LANGS = [
  { code: "en-IN", label: "English" },
  { code: "hi-IN", label: "हिन्दी" },
  { code: "kn-IN", label: "ಕನ್ನಡ" },
] as const;
export type VoiceLang = (typeof VOICE_LANGS)[number]["code"];

interface RecognitionResult { isFinal: boolean; 0: { transcript: string } }
interface RecognitionEvent { resultIndex: number; results: ArrayLike<RecognitionResult> }
export interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const canListen = () => ctor() !== null;
export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

/** Start listening. Calls onText with live text, onFinal once with the full sentence. */
export function listen(lang: VoiceLang, handlers: {
  onText: (t: string) => void; onFinal: (t: string) => void; onError: (message: string) => void; onEnd: () => void;
}): Recognition | null {
  const C = ctor();
  if (!C) return null;
  const r = new C();
  r.lang = lang;
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  let finalText = "";
  r.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) finalText += res[0].transcript;
      else interim += res[0].transcript;
    }
    handlers.onText((finalText + interim).trim());
  };
  r.onerror = (e) => handlers.onError(
    e.error === "not-allowed" || e.error === "service-not-allowed" ? "Microphone access was blocked. Allow it in the browser's site settings."
      : e.error === "no-speech" ? "Didn't hear anything. Tap the mic and speak again."
        : e.error === "audio-capture" ? "No microphone found. Connect one, or type your question."
          : e.error === "language-not-supported" ? "Voice isn't available for this language in your browser. Try English or type your question."
        : e.error === "network" ? "Voice needs an internet connection." : "Voice input stopped. Try again or type your question.");
  r.onend = () => {
    if (finalText.trim()) handlers.onFinal(finalText.trim());
    handlers.onEnd();
  };
  try {
    r.start();
  } catch {
    handlers.onError("Voice input couldn't start. Try again.");
    return null;
  }
  return r;
}

/** Read text aloud in the chosen language; picks a matching voice if the device has one. */
export function speak(text: string, lang: VoiceLang, onEnd?: () => void): boolean {
  if (!canSpeak()) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/s\.(\d)/g, "section $1"));
  u.lang = lang;
  const voice = synth.getVoices().find((v) => v.lang === lang) ?? synth.getVoices().find((v) => v.lang.startsWith(lang.slice(0, 2)));
  if (voice) u.voice = voice;
  u.rate = 0.95;
  if (onEnd) { u.onend = onEnd; u.onerror = onEnd; }
  synth.speak(u);
  return true;
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel();
}

/** Remembered per browser; storage may be blocked, so every access is guarded. */
export function loadPref<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = window.localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
export function savePref(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* ignore */ }
}
