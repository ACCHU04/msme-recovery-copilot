"use client";

import {
  Bell, BookOpenText, Bot, BriefcaseBusiness, Building2, ChevronDown, FileBarChart, FileSignature, FileText, FolderKanban,
  LayoutDashboard, LifeBuoy, LogOut, Menu, Scale, Search, Settings, ShieldCheck, ShoppingBag, Store, TrendingUp, UserRound, Users, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";
import { api } from "@/lib/api";
import { formatINR } from "@/lib/format";
import { signOutAction } from "@/app/auth/actions";
import { AssistantDock } from "@/components/assistant/Dock";
import { canAccess, HOME, ROLE_LABEL, type Viewer } from "@/lib/auth/access";
import { ViewerContext } from "@/lib/auth/viewer";
import { getSession, initials, signOut } from "@/lib/session";
import type { InvoiceRow, Reminder, Reminders } from "@/types/api";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/profile", label: "Business Profile", icon: Building2 },
  { href: "/contracts", label: "Contracts", icon: FileSignature },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/cashflow", label: "Cash Flow", icon: TrendingUp },
  { href: "/cases", label: "Recovery Cases", icon: FolderKanban },
  { href: "/assistant", label: "Recovery Assistant", icon: Bot },
  { href: "/legal", label: "Legal Assistant", icon: Scale },
  { href: "/buyers", label: "Buyer Profile", icon: Users },
  { href: "/marketplace", label: "Marketplace", icon: Store },
  { href: "/adviser", label: "Adviser Portal", icon: BriefcaseBusiness },
  { href: "/reports", label: "Reports", icon: FileBarChart },
  { href: "/buyer", label: "Buyer Dashboard", icon: ShoppingBag },
  { href: "/admin", label: "Admin Dashboard", icon: ShieldCheck },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Pages shown without the sidebar: sign-in screens, account status screens, print views. */
const BARE = ["/login", "/register", "/registered", "/forgot-password", "/reset-password", "/verify-email",
  "/pending-approval", "/access-denied"];
const isBare = (path: string) => BARE.some((p) => path === p || path.startsWith(p + "/")) || path.endsWith("/report");

/** Demo mode: one fictional supplier, so the supplier pages plus the adviser preview. */
const DEMO_HIDDEN = new Set(["/admin"]);

function demoViewer(): Viewer | null {
  const s = getSession();
  return s ? { id: "demo", email: s.email, name: s.name, role: "supplier", approval: "approved",
               emailVerified: true, businessName: null } : null;
}

function isActive(path: string, href: string) {
  if (href === "/") return path === "/";
  return path === href || path.startsWith(href + "/");
}

function Logo({ small }: { small?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className={small ? "h-7 w-7" : "h-9 w-9"} aria-hidden>
        <rect x="3" y="14" width="5" height="14" rx="1.5" fill="currentColor" opacity=".7" />
        <rect x="10" y="8" width="5" height="20" rx="1.5" fill="currentColor" />
        <rect x="17" y="4" width="5" height="24" rx="1.5" fill="currentColor" />
        <rect x="24" y="11" width="5" height="17" rx="1.5" fill="currentColor" opacity=".7" />
        <rect x="1" y="28" width="30" height="2.5" rx="1.2" fill="currentColor" />
      </svg>
      <span className="leading-tight">
        <span className={cx("block font-extrabold tracking-tight", small ? "text-base" : "text-xl")}>Settle45</span>
        <span className="block text-[11px] font-medium opacity-90">MSME Payment Recovery Assistant</span>
      </span>
    </span>
  );
}

function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const load = () => { if (!rows) api.listInvoices().then(setRows).catch(() => setRows([])); };
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || !rows) return [];
    return rows.filter((r) => r.number.toLowerCase().includes(s) || (r.buyer_name ?? "").toLowerCase().includes(s)).slice(0, 6);
  }, [q, rows]);
  return (
    <div className="relative w-full max-w-md">
      <label htmlFor="global-search" className="sr-only">Search invoices and buyers</label>
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
      <input id="global-search" value={q} placeholder="Search invoices, buyers…" autoComplete="off"
        onFocus={() => { load(); setOpen(true); }} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && results[0]) router.push(`/invoices/${results[0].id}`); }}
        className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm focus-visible:bg-white focus-visible:outline-2 focus-visible:outline-brand-600" />
      {open && q.trim() && (
        <div className="absolute z-40 mt-1 w-full rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {!rows && <p className="px-3 py-2 text-slate-500">Searching…</p>}
          {rows && results.length === 0 && <p className="px-3 py-2 text-slate-500">No invoices or buyers match “{q}”.</p>}
          {results.map((r) => (
            <Link key={r.id} href={`/invoices/${r.id}`} className="flex justify-between gap-3 px-3 py-2 hover:bg-slate-50">
              <span><span className="font-medium">{r.number}</span> <span className="text-slate-500">· {r.buyer_name}</span></span>
              <span className="tabular-nums text-slate-600">{formatINR(r.amount)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const SEVERITY_STYLE: Record<Reminder["severity"], string> = {
  high: "bg-red-500", warn: "bg-amber-500", info: "bg-sky-500",
};

function Alerts() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Reminders | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    api.reminders().then(setData).catch(() => setData({ as_of: "", items: [], email_available: false }));
  }, []);
  const items = data?.items ?? [];
  const urgent = items.some((r) => r.severity !== "info");
  async function dismiss(key: string) {
    setData((d) => (d ? { ...d, items: d.items.filter((r) => r.key !== key) } : d));
    try { await api.dismissReminder(key); } catch { setMsg("Could not hide that reminder. It may come back."); }
  }
  async function email() {
    setSending(true); setMsg(null);
    try {
      const r = await api.emailReminders();
      setMsg(r.sent ? `Sent ${r.count} reminder${r.count === 1 ? "" : "s"} to ${r.to}.` : (r.detail ?? "Nothing to send."));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not send the email.");
    } finally { setSending(false); }
  }
  return (
    <div className="relative">
      <button type="button" aria-label={`Reminders${items.length ? `, ${items.length}` : ""}`} aria-expanded={open}
        onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 hover:bg-slate-100">
        <Bell size={20} />
        {items.length > 0 && (
          <span aria-hidden className={cx("absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full px-1 text-center text-[11px] font-semibold leading-[18px] text-white ring-2 ring-white",
            urgent ? "bg-red-500" : "bg-sky-500")}>{items.length > 9 ? "9+" : items.length}</span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Reminders" className="fixed inset-x-3 top-16 z-40 rounded-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[22rem] border border-slate-200 bg-white p-2 shadow-lg">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-xs font-semibold uppercase text-slate-500">Reminders for today</p>
            {data?.email_available && items.length > 0 && (
              <button type="button" onClick={email} disabled={sending}
                className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50">
                {sending ? "Sending…" : "Email me these"}
              </button>
            )}
          </div>
          {msg && <p role="status" className="mx-2 mb-1 rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-700">{msg}</p>}
          {!data && <p className="px-2 py-2 text-sm text-slate-500">Loading…</p>}
          {data && items.length === 0 && <p className="px-2 py-2 text-sm text-slate-600">Nothing needs your attention today.</p>}
          <ul className="max-h-96 overflow-y-auto">
            {items.map((r) => (
              <li key={r.key} className="group flex gap-2 rounded-lg px-2 py-2 hover:bg-slate-50">
                <span aria-hidden className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", SEVERITY_STYLE[r.severity])} />
                <Link href={r.link} onClick={() => setOpen(false)} className="min-w-0 flex-1 text-sm">
                  <span className="block font-medium text-slate-900">{r.title}</span>
                  <span className="block text-xs text-slate-600">{r.detail}</span>
                </Link>
                <button type="button" onClick={() => dismiss(r.key)} aria-label={`Hide reminder: ${r.title}`}
                  className="h-6 shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function AppShell({ children, viewer: serverViewer, authEnabled }:
  { children: ReactNode; viewer: Viewer | null; authEnabled: boolean }) {
  const path = usePathname();
  const router = useRouter();
  // Real sign-in: the viewer comes from the server (middleware has already enforced access).
  // Demo mode: the labelled demo session in this browser.
  const [demo, setDemo] = useState<Viewer | null | undefined>(undefined);
  const viewer = authEnabled ? serverViewer : demo;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [business, setBusiness] = useState<string | null>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const bare = isBare(path);
  const role = viewer?.role ?? null;
  const isSupplier = role === "supplier";

  useEffect(() => { setMobileOpen(false); setUserOpen(false); }, [path]);
  useEffect(() => {
    if (authEnabled) return;
    const v = demoViewer();
    setDemo(v);
    if (!v && path !== "/login" && path !== "/register" && !path.startsWith("/confirm/")) router.replace("/login");
  }, [authEnabled, path, router]);
  useEffect(() => {
    if (viewer && isSupplier && !bare) api.getBusiness().then((b) => setBusiness(b.name)).catch(() => setBusiness(null));
  }, [viewer, isSupplier, bare]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setMobileOpen(false); setUserOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const wrap = (node: ReactNode) => <ViewerContext.Provider value={viewer ?? null}>{node}</ViewerContext.Provider>;
  // Public pages for people without an account (e.g. a buyer confirming delivery).
  if (path.startsWith("/confirm/")) return <div className="min-h-screen bg-canvas">{children}</div>;
  if (bare && (authEnabled || path === "/login" || path === "/register")) {
    return wrap(<div className="min-h-screen bg-canvas">{children}</div>);
  }
  if (!viewer) return <div className="min-h-screen bg-canvas" aria-busy="true" />;
  if (bare) return wrap(<div className="min-h-screen bg-canvas">{children}</div>);

  const nav = NAV.filter(({ href }) => (authEnabled ? canAccess(href, role) : !DEMO_HIDDEN.has(href)));
  const home = role ? HOME[role] : "/";
  const roleLabel = authEnabled ? (role ? ROLE_LABEL[role] : "No role") : "Owner · demo";
  const signOutButton = authEnabled ? (
    <form action={signOutAction}>
      <button type="submit" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-red-700 hover:bg-red-50">
        <LogOut size={16} aria-hidden /> Sign out
      </button>
    </form>
  ) : (
    <button type="button" onClick={() => { signOut(); router.replace("/login"); }}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-red-700 hover:bg-red-50">
      <LogOut size={16} aria-hidden /> Sign out
    </button>
  );

  const sidebar = (
    <div className="flex h-full flex-col bg-navy-800 text-white">
      <div className="px-5 py-4"><Link href={home} aria-label="Settle45, MSME Payment Recovery Assistant, home"><Logo /></Link></div>
      <nav aria-label="Main" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = isActive(path, href);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined}
              className={cx("flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] font-medium",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white",
                active ? "bg-brand-600 text-white shadow-sm" : "text-white/85 hover:bg-white/10 hover:text-white")}>
              <Icon size={20} aria-hidden /> {label}
            </Link>
          );
        })}
      </nav>
      <div className="m-3 rounded-xl bg-navy-700/80 p-3">
        <p className="flex items-center gap-2 font-semibold"><LifeBuoy size={18} aria-hidden /> Need help?</p>
        <p className="mt-1 text-xs text-white/80">How deadlines and interest are worked out.</p>
        <Link href="/legal" className="mt-2 flex items-center justify-center gap-2 rounded-lg border border-white/40 py-1.5 text-sm font-medium hover:bg-white/10">
          <BookOpenText size={16} aria-hidden /> Open the guide
        </Link>
      </div>
    </div>
  );

  return wrap(
    <div className="min-h-screen bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">Skip to content</a>
      <aside className={cx("fixed inset-y-0 left-0 z-30 hidden w-64 lg:block", collapsed && "lg:hidden")}>{sidebar}</aside>
      {mobileOpen && (
        <div id="mobile-nav" className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setMobileOpen(false)}>
          <aside className="h-full w-72" onClick={(e) => e.stopPropagation()}>{sidebar}</aside>
        </div>
      )}

      <div className={cx("flex min-h-screen flex-col", !collapsed && "lg:pl-64")}>
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white px-3 sm:px-6">
          <button type="button" className="rounded-lg p-2 hover:bg-slate-100" aria-controls="mobile-nav"
            aria-label={mobileOpen ? "Close menu" : "Open menu"} aria-expanded={mobileOpen}
            onClick={() => (window.innerWidth >= 1024 ? setCollapsed((c) => !c) : setMobileOpen((o) => !o))}>
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          <div className="hidden min-w-0 flex-1 sm:block">{isSupplier && <GlobalSearch />}</div>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {isSupplier ? (
              <Link href="/profile" className="hidden items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50 md:flex">
                <span className="rounded-md bg-brand-600 p-1 text-white"><Building2 size={16} aria-hidden /></span>
                <span className="max-w-44 truncate">{business ?? "Set up business"}</span>
              </Link>
            ) : viewer.businessName && (
              <span className="hidden items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium md:flex">
                <span className="rounded-md bg-brand-600 p-1 text-white"><Building2 size={16} aria-hidden /></span>
                <span className="max-w-44 truncate">{viewer.businessName}</span>
              </span>
            )}
            {isSupplier && <Alerts />}
            <div className="relative" ref={userRef}>
              <button type="button" onClick={() => setUserOpen((o) => !o)} aria-expanded={userOpen} aria-label="Account menu"
                className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-100">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">{initials(viewer.name)}</span>
                <span className="hidden text-left leading-tight md:block">
                  <span className="block text-sm font-semibold">{viewer.name}</span>
                  <span className="block text-xs text-slate-500">{roleLabel}</span>
                </span>
                <ChevronDown size={16} className="hidden md:block" aria-hidden />
              </button>
              {userOpen && (
                <div className="absolute right-0 z-40 mt-2 w-52 rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-lg">
                  <p className="truncate px-3 py-2 text-xs text-slate-500">{viewer.email}</p>
                  {isSupplier && <Link href="/profile" className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"><UserRound size={16} aria-hidden /> Business profile</Link>}
                  <Link href="/settings" className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"><Settings size={16} aria-hidden /> Account settings</Link>
                  {signOutButton}
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main" className="min-w-0 flex-1 p-4 pb-24 sm:p-6 sm:pb-24 lg:p-8 lg:pb-24">{children}</main>
      </div>
      <AssistantDock canCheckDocuments={isSupplier} />
    </div>
  );
}

export { Logo };
