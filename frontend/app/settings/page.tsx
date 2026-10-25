"use client";

import { Bell, CheckCircle, Loader2, LogOut, Mail, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, Button, Card, Notice } from "@/components/ui";
import { api } from "@/lib/api";
import { signOutAction } from "@/app/auth/actions";
import { ROLE_LABEL } from "@/lib/auth/access";
import { authEnabled } from "@/lib/auth/config";
import { useViewer } from "@/lib/auth/viewer";
import { signOut } from "@/lib/session";

export default function SettingsPage() {
  const router = useRouter();
  const [health, setHealth] = useState<{ ok: boolean; store: string; engine_version: string } | null | "down">(null);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const [remindersCount, setRemindersCount] = useState<number | null>(null);
  const viewer = useViewer();

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth("down"));
    api.getReminders().then((r) => setRemindersCount(r.reminders.length)).catch(() => setRemindersCount(null));
  }, []);

  async function handleSendTest() {
    setEmailBusy(true);
    setEmailStatus(null);
    try {
      const res = await api.sendTestNotification();
      setEmailStatus(`Test email sent successfully to ${res.sent_to}! (ID: ${res.email_id})`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not send test email.";
      setEmailStatus(`Failed: ${msg}`);
    } finally {
      setEmailBusy(false);
    }
  }

  async function handleSendDigest() {
    setEmailBusy(true);
    setEmailStatus(null);
    try {
      const res = await api.sendReminderDigest();
      setEmailStatus(`Daily digest sent to ${res.sent_to} with ${res.reminders_count ?? 0} alerts! (ID: ${res.email_id})`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not send digest.";
      setEmailStatus(`Failed: ${msg}`);
    } finally {
      setEmailBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-slate-600">Account and connection details.</p>
      </div>
      <Card title="Account">
        <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
          <dt className="text-slate-500">Signed in as</dt><dd className="min-w-0 break-words">{viewer?.name} ({viewer?.email})</dd>
          {authEnabled ? (
            <>
              <dt className="text-slate-500">Account type</dt><dd>{viewer?.role ? ROLE_LABEL[viewer.role] : "Unknown"}</dd>
              <dt className="text-slate-500">Status</dt><dd><Badge tone={viewer?.approval === "approved" ? "green" : "amber"}>{viewer?.approval === "approved" ? "Approved" : "Waiting for approval"}</Badge></dd>
              <dt className="text-slate-500">Sign-in</dt><dd>Supabase Auth, email verified. To change your password, sign out and use “Forgot password?”.</dd>
            </>
          ) : (
            <>
              <dt className="text-slate-500">Sign-in type</dt><dd><Badge tone="amber">Demo sign-in</Badge> <span className="text-slate-600">Passwords are not checked in this build.</span></dd>
            </>
          )}
        </dl>
        {authEnabled ? (
          <form action={signOutAction} className="mt-4"><Button type="submit" variant="danger"><LogOut size={16} aria-hidden /> Sign out</Button></form>
        ) : (
          <Button className="mt-4" variant="danger" onClick={() => { signOut(); router.replace("/login"); }}><LogOut size={16} aria-hidden /> Sign out</Button>
        )}
      </Card>

      <Card title={<span className="flex items-center gap-2"><Mail size={20} className="text-brand-600" aria-hidden /> Email Notifications &amp; Reminders (Resend)</span>}>
        <p className="text-sm text-slate-600">
          Automated daily alerts for invoices approaching statutory 45-day due dates, promises due tomorrow, and broken buyer promises.
        </p>
        <dl className="mt-3 grid grid-cols-[140px_1fr] gap-y-2 text-sm">
          <dt className="text-slate-500">Service</dt>
          <dd><Badge tone="green">Resend API Connected</Badge></dd>
          <dt className="text-slate-500">Alert recipient</dt>
          <dd className="font-medium text-slate-800">acchuachutha004@gmail.com</dd>
          <dt className="text-slate-500">Active rules</dt>
          <dd className="text-slate-700">
            <ul className="list-inside list-disc space-y-0.5 text-xs">
              <li>3 days before statutory due date under MSMED Act</li>
              <li>Buyer promise due today or tomorrow</li>
              <li>Broken promise alert requiring escalation</li>
              <li>Invoice overdue &amp; Section 16 compound interest started</li>
            </ul>
          </dd>
          {remindersCount !== null && (
            <>
              <dt className="text-slate-500">Alerts today</dt>
              <dd><Badge tone={remindersCount > 0 ? "amber" : "slate"}>{remindersCount} item{remindersCount === 1 ? "" : "s"} needing attention</Badge></dd>
            </>
          )}
        </dl>

        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="secondary" onClick={handleSendTest} disabled={emailBusy}>
            {emailBusy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Send size={16} aria-hidden />}
            Send test email
          </Button>
          <Button variant="primary" onClick={handleSendDigest} disabled={emailBusy}>
            {emailBusy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Bell size={16} aria-hidden />}
            Send today&apos;s digest
          </Button>
        </div>

        {emailStatus && (
          <p role="status" className="mt-3 flex items-center gap-1.5 text-sm font-medium text-brand-600">
            <CheckCircle size={16} className="text-emerald-600" aria-hidden /> {emailStatus}
          </p>
        )}
      </Card>
      <Card title="Connection">
        {health === null && <p className="text-sm text-slate-600">Checking…</p>}
        {health === "down" && <p className="text-sm text-red-700">The backend can&apos;t be reached. Start it with uvicorn and refresh.</p>}
        {health && health !== "down" && (
          <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Backend</dt><dd><Badge tone="green">Connected</Badge></dd>
            <dt className="text-slate-500">Data store</dt><dd>{health.store === "memory" ? "Demo data in memory (resets when the server restarts)" : "Supabase database"}</dd>
            <dt className="text-slate-500">Calculation engine</dt><dd>Version {health.engine_version}</dd>
          </dl>
        )}
      </Card>
      <Notice>Business details that decide eligibility are on the Business Profile page.</Notice>
    </div>
  );
}
