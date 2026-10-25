// Supabase client for server code only: server components, server actions, route handlers.
// It reads and writes the HttpOnly session cookies; the browser never sees the tokens.
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import type { Approval, Role, Viewer } from "./access";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { hardenCookie, REMEMBER_COOKIE } from "./cookies";

export async function supabaseServer() {
  const store = await cookies();
  const remember = store.get(REMEMBER_COOKIE)?.value === "1";
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, hardenCookie(options, remember));
        } catch {
          // Server components cannot set cookies; middleware.ts refreshes the session instead.
        }
      },
    },
  });
}

export type SupabaseServer = Awaited<ReturnType<typeof supabaseServer>>;

export interface ProfileRow {
  full_name: string;
  email: string;
  role: Role;
  approval_status: Approval;
  business_name: string | null;
}

export async function loadProfile(supabase: SupabaseServer, userId: string): Promise<ProfileRow | null> {
  const { data } = await supabase.from("profiles")
    .select("full_name, email, role, approval_status, business_name")
    .eq("id", userId).maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

export function toViewer(user: { id: string; email?: string | null; email_confirmed_at?: string | null },
                         p: ProfileRow | null): Viewer {
  return {
    id: user.id,
    email: user.email ?? p?.email ?? "",
    name: p?.full_name ?? (user.email ?? "").split("@")[0],
    role: p?.role ?? null,
    approval: p?.approval_status ?? null,
    emailVerified: Boolean(user.email_confirmed_at),
    businessName: p?.business_name ?? null,
  };
}

/** Base URL for links in emails. Set NEXT_PUBLIC_SITE_URL in production; Supabase also
 *  refuses redirect URLs that are not in the project's allow list. */
export async function siteOrigin(): Promise<string> {
  const fixed = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (fixed) return fixed;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
