"use client";

// Floating assistant in the bottom-right corner of every page: "Ask" (legal Q&A with AI and
// voice) and, for suppliers, "Check a document". Other pages can open it on a tab with
// openAssistant({ tab: "doc", invoiceId }).
import { FileSearch, MessageCircle, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { Chat } from "./Chat";
import { DocumentCheck } from "./DocumentCheck";

type Tab = "ask" | "doc";
interface OpenDetail { tab?: Tab; invoiceId?: string; expected?: string }
const EVENT = "ls03:assistant";

export function openAssistant(detail: OpenDetail = {}) {
  window.dispatchEvent(new CustomEvent<OpenDetail>(EVENT, { detail }));
}

export function AssistantDock({ canCheckDocuments }: { canCheckDocuments: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("ask");
  const [ctx, setCtx] = useState<OpenDetail>({});
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<OpenDetail>).detail ?? {};
      setCtx(d);
      setTab(d.tab === "doc" && canCheckDocuments ? "doc" : "ask");
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener(EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener(EVENT, onOpen); window.removeEventListener("keydown", onKey); };
  }, [canCheckDocuments]);
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    else button.current?.focus({ preventScroll: true });
  }, [open]);

  return (
    <>
      {!open && (
        <button ref={button} type="button" onClick={() => setOpen(true)} aria-label="Open assistant" aria-haspopup="dialog"
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-brand-600 px-4 py-3 font-semibold text-white shadow-lg hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 print:hidden">
          <Sparkles size={20} aria-hidden /><span className="hidden sm:inline">Assistant</span>
        </button>
      )}
      {open && (
        <div ref={panel} role="dialog" aria-label="Assistant" aria-modal="false"
          className="fixed inset-0 z-50 flex flex-col bg-white shadow-2xl sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[min(680px,calc(100vh-2.5rem))] sm:w-[420px] sm:rounded-2xl sm:border sm:border-slate-200 print:hidden">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
            <p className="flex items-center gap-2 font-bold text-navy-900"><Sparkles size={18} className="text-brand-600" aria-hidden /> Assistant</p>
            <button type="button" data-autofocus onClick={() => setOpen(false)} aria-label="Close assistant" className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"><X size={18} aria-hidden /></button>
          </div>
          {canCheckDocuments && (
            <div role="tablist" aria-label="Assistant" className="flex border-b border-slate-200 px-2">
              {([["ask", "Ask", MessageCircle], ["doc", "Check a document", FileSearch]] as const).map(([id, label, Icon]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={cx("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium",
                    tab === id ? "border-brand-600 text-brand-600" : "border-transparent text-slate-600 hover:text-navy-900")}>
                  <Icon size={16} aria-hidden /> {label}
                </button>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto p-4" role="tabpanel">
            {tab === "ask" ? <Chat panel /> : <DocumentCheck key={ctx.invoiceId ?? "none"} invoiceId={ctx.invoiceId} expected={ctx.expected} />}
          </div>
        </div>
      )}
    </>
  );
}
