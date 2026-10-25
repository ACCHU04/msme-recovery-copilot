"use client";

import { Hourglass, ShieldX } from "lucide-react";
import Link from "next/link";
import { signOutAction } from "@/app/auth/actions";
import { AuthLayout, FormAlert } from "@/components/auth";
import { useViewer } from "@/lib/auth/viewer";

export default function PendingApprovalPage() {
  const viewer = useViewer();
  const rejected = viewer?.approval === "rejected";
  return (
    <AuthLayout title={rejected ? "Adviser account not approved" : "Waiting for approval"}>
      <div className="space-y-5">
        <div className="flex justify-center">
          <span className={rejected ? "rounded-full bg-red-50 p-4 text-red-700" : "rounded-full bg-blue-50 p-4 text-brand-600"}>
            {rejected ? <ShieldX size={36} aria-hidden /> : <Hourglass size={36} aria-hidden />}
          </span>
        </div>
        {rejected ? (
          <FormAlert tone="error">An administrator reviewed your adviser account and did not approve it. Contact support if you think this is a mistake.</FormAlert>
        ) : (
          <>
            <FormAlert tone="info">Your email is verified. An administrator now checks adviser accounts before they can open the adviser portal.</FormAlert>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              <li>We check the professional role and qualifications you gave.</li>
              <li>Come back and sign in later; this page updates once you&apos;re approved.</li>
            </ul>
          </>
        )}
        {viewer && <p className="text-sm text-slate-600">Signed in as <strong>{viewer.name}</strong> ({viewer.email})</p>}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link href="/pending-approval" className="flex-1 rounded-lg border border-slate-300 py-2.5 text-center font-semibold hover:bg-slate-50">Check again</Link>
          <form action={signOutAction} className="flex-1">
            <button type="submit" className="w-full rounded-lg bg-brand-600 py-2.5 font-semibold text-white hover:bg-brand-700">Sign out</button>
          </form>
        </div>
      </div>
    </AuthLayout>
  );
}
