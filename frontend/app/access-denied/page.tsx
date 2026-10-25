"use client";

import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { signOutAction } from "@/app/auth/actions";
import { AuthLayout, FormAlert } from "@/components/auth";
import { HOME, ROLE_LABEL } from "@/lib/auth/access";
import { useViewer } from "@/lib/auth/viewer";

function Body() {
  const q = useSearchParams();
  const viewer = useViewer();
  const noProfile = q.get("reason") === "profile";
  const home = viewer?.role ? HOME[viewer.role] : "/login";
  return (
    <div className="space-y-5">
      <div className="flex justify-center"><span className="rounded-full bg-red-50 p-4 text-red-700"><ShieldAlert size={36} aria-hidden /></span></div>
      <FormAlert tone="error">
        {noProfile
          ? "Your account has no profile, so we can't tell which pages you may use. Sign out and back in; if this keeps happening, contact support."
          : "This page is for a different kind of account."}
      </FormAlert>
      {viewer?.role && (
        <p className="text-sm text-slate-700">You&apos;re signed in as <strong>{viewer.name}</strong>, a <strong>{ROLE_LABEL[viewer.role].toLowerCase()}</strong> account.</p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        {viewer?.role && <Link href={home} className="flex-1 rounded-lg bg-brand-600 py-2.5 text-center font-semibold text-white hover:bg-brand-700">Go to my dashboard</Link>}
        {viewer ? (
          <form action={signOutAction} className="flex-1">
            <button type="submit" className="w-full rounded-lg border border-slate-300 py-2.5 font-semibold hover:bg-slate-50">Sign out</button>
          </form>
        ) : (
          <Link href="/login" className="flex-1 rounded-lg bg-brand-600 py-2.5 text-center font-semibold text-white">Sign in</Link>
        )}
      </div>
    </div>
  );
}

export default function AccessDeniedPage() {
  return <AuthLayout title="Access denied"><Suspense><Body /></Suspense></AuthLayout>;
}
