// Server component: reads profiles with the admin's own session, so row level security
// decides what comes back (admins see every profile; anyone else would see only their own).
// middleware.ts already keeps non-admins out of this page.
import { BriefcaseBusiness, Hourglass, ShieldCheck, ShoppingBag, Factory } from "lucide-react";
import { Card, EmptyState, KpiCard, Notice } from "@/components/ui";
import { ROLE_LABEL, type Role } from "@/lib/auth/access";
import { authEnabled } from "@/lib/auth/config";
import { supabaseServer } from "@/lib/auth/server";
import { ReviewButtons } from "./ReviewButtons";

interface Row {
  id: string; full_name: string; email: string; business_name: string | null; role: Role;
  approval_status: "pending" | "approved" | "rejected"; professional_role: string | null;
  qualifications: string | null; mobile_number: string | null; created_at: string;
}
interface Review { adviser_id: string; decision: string; note: string | null; decided_at: string }

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!authEnabled) {
    return <div className="mx-auto max-w-3xl"><Notice tone="amber">The admin dashboard needs Supabase sign-in. It is not available in demo mode.</Notice></div>;
  }
  const supabase = await supabaseServer();
  const [{ data: profiles, error }, { data: reviews }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, business_name, role, approval_status, professional_role, qualifications, mobile_number, created_at")
      .order("created_at", { ascending: false }).limit(500),
    supabase.from("adviser_reviews").select("adviser_id, decision, note, decided_at").order("decided_at", { ascending: false }).limit(20),
  ]);
  if (error) return <div className="mx-auto max-w-3xl"><Notice tone="amber">Couldn&apos;t load accounts. Refresh to try again.</Notice></div>;

  const rows = (profiles ?? []) as Row[];
  const count = (r: Role) => rows.filter((p) => p.role === r).length;
  const pending = rows.filter((p) => p.role === "adviser" && p.approval_status === "pending");
  const byId = new Map(rows.map((p) => [p.id, p]));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-bold"><ShieldCheck className="text-brand-600" aria-hidden /> Admin dashboard</h1>
        <p className="text-slate-600">Review adviser accounts and see who is using the service.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Advisers waiting" value={String(pending.length)} sub={pending.length ? "Need a decision" : "Nothing to review"} icon={<Hourglass size={22} />} tone={pending.length ? "amber" : "green"} />
        <KpiCard label="MSME suppliers" value={String(count("supplier"))} icon={<Factory size={22} />} tone="blue" />
        <KpiCard label="Buyers" value={String(count("buyer"))} icon={<ShoppingBag size={22} />} tone="violet" />
        <KpiCard label="Advisers" value={String(count("adviser"))} sub={`${count("adviser") - pending.length} reviewed`} icon={<BriefcaseBusiness size={22} />} tone="green" />
      </div>

      <Card title={`Advisers waiting for approval (${pending.length})`}>
        {pending.length === 0 ? (
          <EmptyState title="No advisers waiting" body="New adviser sign-ups appear here once they have verified their email address." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {pending.map((p) => (
              <li key={p.id} className="grid gap-3 py-4 lg:grid-cols-[1fr_auto] lg:items-start">
                <div className="min-w-0">
                  <p className="font-semibold">{p.full_name} <span className="font-normal text-slate-500">· {p.email}</span></p>
                  <p className="text-sm text-slate-700">{p.professional_role ?? "Role not given"}{p.business_name ? ` at ${p.business_name}` : ""}</p>
                  <p className="text-sm text-slate-600">Qualifications: {p.qualifications ?? "not given"}</p>
                  <p className="text-xs text-slate-500">Registered {fmt(p.created_at)}{p.mobile_number ? ` · ${p.mobile_number}` : ""}</p>
                </div>
                <ReviewButtons target={p.id} name={p.full_name} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Recent decisions">
          {(reviews ?? []).length === 0 ? <p className="text-sm text-slate-600">No adviser decisions yet.</p> : (
            <ul className="space-y-2 text-sm">
              {(reviews as Review[]).map((r, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                  <span><strong>{byId.get(r.adviser_id)?.full_name ?? "Adviser"}</strong> {r.decision}{r.note ? `: ${r.note}` : ""}</span>
                  <span className="text-slate-500">{fmt(r.decided_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Newest accounts">
          <ul className="space-y-2 text-sm">
            {rows.slice(0, 8).map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2">
                <span className="min-w-0 truncate">{p.full_name} <span className="text-slate-500">· {ROLE_LABEL[p.role]}{p.approval_status !== "approved" ? ` (${p.approval_status})` : ""}</span></span>
                <span className="text-slate-500">{fmt(p.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Notice>Admins are added by the project owner in the Supabase SQL editor (see the README). The app cannot create admins or change roles.</Notice>
    </div>
  );
}
