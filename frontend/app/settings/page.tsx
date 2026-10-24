"use client";

import { LogOut } from "lucide-react";
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
  const viewer = useViewer();
  useEffect(() => { api.health().then(setHealth).catch(() => setHealth("down")); }, []);

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
