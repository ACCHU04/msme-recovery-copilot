"use client";

import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AuthLayout, FormAlert } from "@/components/auth";

function Body() {
  const adviser = useSearchParams().get("type") === "adviser";
  return (
    <div className="space-y-5">
      <div className="flex justify-center"><span className="rounded-full bg-green-50 p-4 text-green-700"><MailCheck size={36} aria-hidden /></span></div>
      <FormAlert tone="success">Your account has been created. Verify your email address to start using it.</FormAlert>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
        <li>Open the email we just sent you. If you can&apos;t find it, check spam or promotions.</li>
        <li>Click <strong>Confirm your email</strong>. Open it in this browser if you can; that signs you in straight away.</li>
        <li>{adviser
          ? "An administrator then reviews adviser accounts. You can sign in and see your approval status meanwhile."
          : "You'll be taken to your dashboard."}</li>
      </ol>
      <p className="text-sm text-slate-600">The link works once and expires after a short time. If it has expired, ask for a new one.</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Link href="/login" className="flex-1 rounded-lg bg-brand-600 py-2.5 text-center font-semibold text-white hover:bg-brand-700">Go to sign in</Link>
        <Link href="/verify-email" className="flex-1 rounded-lg border border-slate-300 py-2.5 text-center font-semibold hover:bg-slate-50">Resend the email</Link>
      </div>
    </div>
  );
}

export default function RegisteredPage() {
  return <AuthLayout title="Check your email"><Suspense><Body /></Suspense></AuthLayout>;
}
