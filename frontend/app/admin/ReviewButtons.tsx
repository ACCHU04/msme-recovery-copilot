"use client";

import { Check, Loader2, X } from "lucide-react";
import { useActionState, useState } from "react";
import { reviewAdviserAction, type FormState } from "@/app/auth/actions";
import { inputClass } from "@/components/ui";

export function ReviewButtons({ target, name }: { target: string; name: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(reviewAdviserAction, {});
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(null);
  return (
    <form action={action} className="flex flex-col gap-2 lg:w-80" aria-label={`Review ${name}`}>
      <input type="hidden" name="target" value={target} />
      <label htmlFor={`note-${target}`} className="sr-only">Note for {name}</label>
      <input id={`note-${target}`} name="note" maxLength={500} placeholder="Note (optional), e.g. checked ICAI number" className={`${inputClass} py-2 text-sm`} />
      <div className="flex gap-2">
        <button type="submit" name="decision" value="approved" disabled={pending} onClick={() => setDecision("approved")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
          {pending && decision === "approved" ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} aria-hidden />} Approve
        </button>
        <button type="submit" name="decision" value="rejected" disabled={pending} onClick={() => setDecision("rejected")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-300 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60">
          {pending && decision === "rejected" ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <X size={16} aria-hidden />} Reject
        </button>
      </div>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state.message && <p role="status" className="text-sm text-emerald-700">{state.message}</p>}
    </form>
  );
}
