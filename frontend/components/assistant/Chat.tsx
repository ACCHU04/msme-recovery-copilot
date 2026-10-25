"use client";

// The legal Q&A chat: used as a card on the Legal Assistant page and inside the floating
// assistant panel. AI answers (when switched on), voice in and out, prepared-answer fallback.
import { BookOpen, MessageSquareText, Mic, MicOff, Send, Sparkles, Square, Volume2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Badge, Button, Card, cx, inputClass } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useViewer } from "@/lib/auth/viewer";
import { answer, QAS, type QA } from "@/lib/legal";
import { initials } from "@/lib/session";
import { canListen, canSpeak, listen, loadPref, savePref, speak, stopSpeaking, VOICE_LANGS, type Recognition, type VoiceLang } from "@/lib/voice";
import type { LegalAnswer } from "@/types/api";

type Msg = {
  from: "user" | "guide"; text: string; qa?: QA | null;
  kind?: "ai" | "prepared" | "none" | "pending"; cites?: LegalAnswer["citations"];
};
const NO_ANSWER = "I can only answer questions about delayed payments to micro and small suppliers: deadlines, interest, who the law covers, contract terms, disputes, documents, filing, keeping the customer, tax and the 2026 amendment. For anything else, please ask a legal professional.";

function scriptLang(text: string, fallback: VoiceLang): VoiceLang {
  if (/[\u0C80-\u0CFF]/.test(text)) return "kn-IN";
  if (/[\u0900-\u097F]/.test(text)) return "hi-IN";
  return /[a-z]/i.test(text) ? "en-IN" : fallback;
}

function Switch({ id, checked, onChange, label, disabled }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label htmlFor={id} className={cx("flex items-center gap-2 text-sm", disabled && "opacity-50")}>
      <button id={id} type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cx("relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
          checked ? "bg-brand-600" : "bg-slate-300")}>
        <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", checked ? "left-4.5" : "left-0.5")} />
      </button>
      {label}
    </label>
  );
}

export function Chat({ panel = false }: { panel?: boolean }) {
  const [ai, setAi] = useState<{ enabled: boolean; model: string | null } | null>(null);
  const [aiOn, setAiOn] = useState(true);
  const [readAloud, setReadAloud] = useState(false);
  const [lang, setLang] = useState<VoiceLang>("en-IN");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voice, setVoice] = useState({ listen: false, speak: false });
  const rec = useRef<Recognition | null>(null);
  const name = useViewer()?.name ?? "You";
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [msgs]);
  useEffect(() => {
    api.legalStatus().then((s) => setAi({ enabled: s.ai_enabled, model: s.model })).catch(() => setAi({ enabled: false, model: null }));
    setVoice({ listen: canListen(), speak: canSpeak() });
    setAiOn(loadPref("ls03.ai", "on", ["on", "off"] as const) === "on");
    setReadAloud(loadPref("ls03.readAloud", "off", ["on", "off"] as const) === "on");
    setLang(loadPref<VoiceLang>("ls03.voiceLang", "en-IN", VOICE_LANGS.map((l) => l.code)));
    return () => { rec.current?.abort(); stopSpeaking(); };
  }, []);
  const useAi = !!ai?.enabled && aiOn;

  const say = (text: string, idx: number) => {
    if (!voice.speak) return;
    if (speakingIdx === idx) { stopSpeaking(); setSpeakingIdx(null); return; }
    setSpeakingIdx(idx);
    speak(text, scriptLang(text, lang), () => setSpeakingIdx((cur) => (cur === idx ? null : cur)));
  };

  const prepared = (text: string): Msg => {
    const qa = answer(text);
    return qa ? { from: "guide", text: qa.a, qa, kind: "prepared" } : { from: "guide", text: NO_ANSWER, kind: "none" };
  };
  /** Suggested questions use the team's reviewed answers. Typed or spoken questions go to the
   *  AI when it is available and switched on; anything it can't answer safely falls back. */
  const ask = async (text: string, viaAi: boolean) => {
    const t = text.trim();
    if (!t || busy) return;
    setQ("");
    stopSpeaking(); setSpeakingIdx(null);
    let reply: Msg;
    if (!viaAi || !useAi || t.length < 3) {
      reply = prepared(t);
      setMsgs((m) => [...m, { from: "user", text: t }, reply]);
    } else {
      setBusy(true);
      setMsgs((m) => [...m, { from: "user", text: t }, { from: "guide", text: "Checking the Act…", kind: "pending" }]);
      try {
        const r = await api.legalAsk(t.slice(0, 500));
        reply = r.source === "ai" ? { from: "guide", text: r.answer, kind: "ai", cites: r.citations }
          : r.source === "out_of_scope" ? { from: "guide", text: NO_ANSWER, kind: "none" }
          : prepared(t);
      } catch (e) {
        reply = e instanceof ApiError && e.status === 429 ? { from: "guide", text: e.message, kind: "none" } : prepared(t);
      }
      setMsgs((m) => [...m.slice(0, -1), reply]);
      setBusy(false);
    }
  };
  // "Read answers aloud": speak each new answer once (rendered index = msgs.length, after the intro).
  const spokenUpTo = useRef(0);
  useEffect(() => {
    const last = msgs[msgs.length - 1];
    if (!readAloud || !voice.speak || !last || last.from !== "guide" || last.kind === "pending" || spokenUpTo.current >= msgs.length) return;
    spokenUpTo.current = msgs.length;
    const idx = msgs.length;
    setSpeakingIdx(idx);
    speak(last.text, scriptLang(last.text, lang), () => setSpeakingIdx((c) => (c === idx ? null : c)));
  }, [msgs, readAloud, voice.speak, lang]);

  const toggleMic = () => {
    setVoiceError(null);
    if (listening) { rec.current?.stop(); return; }
    stopSpeaking(); setSpeakingIdx(null);
    const r = listen(lang, {
      onText: (t) => setQ(t),
      onFinal: (t) => { ask(t, true); },
      onError: (m) => setVoiceError(m),
      onEnd: () => { setListening(false); rec.current = null; },
    });
    if (r) { rec.current = r; setListening(true); }
  };

  const submit = (e: FormEvent) => { e.preventDefault(); ask(q, true); };
  const intro = useAi
    ? "Ask in your own words, by typing or with the mic, in English, Hindi or Kannada: deadlines, interest, who the law covers, disputes, tax or how to file. Answers may only use the MSMED Act texts in this app and show the sections they relied on."
    : "Ask about payment deadlines, interest, who the law covers, disputes or how to file. Answers are prepared explanations of the MSMED Act with section references.";

  const title = <span className="flex items-center gap-2"><MessageSquareText size={20} className="text-brand-600" aria-hidden /> Ask about your rights
      {useAi && <Badge tone="violet" icon={<Sparkles size={12} aria-hidden />}>AI-assisted</Badge>}</span>;
  const content = (<>
      <div ref={listRef} className={cx("flex-1 space-y-4 overflow-y-auto pr-1", panel ? "min-h-0" : "max-h-[520px]")} aria-live="polite">
        {[{ from: "guide", text: intro } as Msg, ...msgs].map((m, i) => (
          <div key={i} className={cx("flex gap-2", m.from === "user" && "flex-row-reverse")}>
            <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold", m.from === "user" ? "bg-brand-600 text-white" : "bg-blue-50 text-brand-600")}>
              {m.from === "user" ? initials(name) : m.kind === "ai" ? <Sparkles size={16} aria-hidden /> : <BookOpen size={16} aria-hidden />}
            </span>
            <div className={cx("max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed", m.from === "user" ? "bg-blue-50" : "border border-slate-200 bg-white")}>
              <span className="sr-only">{m.from === "user" ? "You asked:" : "Guide:"}</span>
              <p className={cx("whitespace-pre-wrap", m.kind === "pending" && "animate-pulse text-slate-500")}>{m.text}</p>
              {m.kind === "ai" && m.cites && (
                <div className="mt-2">
                  <p className="text-xs text-slate-500">AI-assisted answer, checked against these sources:</p>
                  <ul className="mt-1 flex flex-wrap gap-1.5">{m.cites.map((c) => (
                    <li key={c.id}><span title={c.title} className="inline-block rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{c.label}</span></li>))}
                  </ul>
                </div>
              )}
              {m.kind === "prepared" && m.qa && <p className="mt-2 text-xs text-slate-500">Prepared answer · MSMED Act, 2006, {m.qa.sections.join(", ")}</p>}
              {m.from === "guide" && m.kind !== "pending" && i > 0 && voice.speak && (
                <button type="button" onClick={() => say(m.text, i)} aria-pressed={speakingIdx === i}
                  className="mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-brand-600 hover:bg-blue-50">
                  {speakingIdx === i ? <><Square size={12} aria-hidden /> Stop</> : <><Volume2 size={14} aria-hidden /> Listen</>}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {QAS.slice(0, panel ? 3 : 5).map((x) => (
          <button key={x.q} type="button" onClick={() => ask(x.q, false)} disabled={busy} className="rounded-lg border border-blue-200 px-3 py-1.5 text-left text-sm text-brand-600 hover:bg-blue-50 disabled:opacity-60">{x.q}</button>
        ))}
      </div>
      <form onSubmit={submit} className="mt-4 flex gap-2">
        <label htmlFor="legal-q" className="sr-only">Your question</label>
        <input id="legal-q" value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} disabled={busy || listening}
          placeholder={listening ? "Listening… speak now" : "Type or speak your question…"} className={cx(inputClass, listening && "border-red-300 bg-red-50")} />
        {voice.listen && (
          <Button type="button" onClick={toggleMic} disabled={busy} aria-pressed={listening} aria-label={listening ? "Stop listening" : "Ask by voice"}
            className={cx(listening && "border-red-300 bg-red-50 text-red-700")}>
            {listening ? <MicOff size={18} aria-hidden /> : <Mic size={18} aria-hidden />}
          </Button>
        )}
        <Button type="submit" variant="primary" aria-label="Ask" disabled={busy || listening}><Send size={18} /></Button>
      </form>
      {voiceError && <p role="alert" className="mt-2 text-sm text-red-700">{voiceError}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 pt-3">
        <Switch id="ai-toggle" checked={useAi} disabled={!ai?.enabled}
          onChange={(v) => { setAiOn(v); savePref("ls03.ai", v ? "on" : "off"); }}
          label={ai?.enabled ? "AI answers" : "AI answers (not set up)"} />
        {voice.speak && <Switch id="read-toggle" checked={readAloud}
          onChange={(v) => { spokenUpTo.current = msgs.length; setReadAloud(v); savePref("ls03.readAloud", v ? "on" : "off"); if (!v) { stopSpeaking(); setSpeakingIdx(null); } }}
          label="Read answers aloud" />}
        {(voice.listen || voice.speak) && (
          <label htmlFor="voice-lang" className="flex items-center gap-2 text-sm">Voice
            <select id="voice-lang" value={lang} onChange={(e) => { const v = e.target.value as VoiceLang; setLang(v); savePref("ls03.voiceLang", v); }}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm">
              {VOICE_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </label>
        )}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        {useAi
          ? <>Typed and spoken questions are answered by Google Gemini using only the Act texts in this app; an answer that cites anything else or uses a figure not in those texts is replaced by a prepared answer. Questions are sent to Google, so leave out names and personal details. Not legal advice.</>
          : <>Prepared answers, not AI and not legal advice. Check how the law applies to you with a qualified professional.</>}
        {voice.listen && <> Voice input uses your browser&apos;s speech service (in Chrome, Google transcribes the audio).</>}
      </p>
</>);
  if (panel) return <div className="flex h-full min-h-0 flex-col">{content}</div>;
  return <Card className="flex flex-col xl:sticky xl:top-20" title={title}>{content}</Card>;
}
