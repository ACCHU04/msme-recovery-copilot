// Runs on the server before every page. When Supabase is configured it:
//  1. refreshes the session cookie if the access token has expired,
//  2. asks Supabase who the user is (getUser validates the token with Supabase),
//  3. reads their profile (role, approval) under row level security,
//  4. redirects according to lib/auth/access.ts (sign-in, verify email, pending approval,
//     access denied, or their own dashboard),
//  5. passes the viewer to the layout in a request header it sets itself (any incoming
//     header with that name is removed first, so it cannot be forged).
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { decide, type Viewer } from "@/lib/auth/access";
import { authEnabled, SUPABASE_ANON_KEY, SUPABASE_URL, VIEWER_HEADER } from "@/lib/auth/config";
import { hardenCookie, REMEMBER_COOKIE, type CookieOpts } from "@/lib/auth/cookies";

/** The `sub` (user id) inside an access token, read without verifying it: only a hint. */
function subjectOf(token?: string): string | undefined {
  try {
    const part = token?.split(".")[1];
    if (!part) return undefined;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === "string" ? sub : undefined;
  } catch { return undefined; }
}

export async function middleware(req: NextRequest) {
  if (!authEnabled) {
    const headers = new Headers(req.headers);
    headers.delete(VIEWER_HEADER);
    return NextResponse.next({ request: { headers } });
  }

  const remember = req.cookies.get(REMEMBER_COOKIE)?.value === "1";
  // The session cookie is sb-<project>-auth-token, split into .0/.1 chunks when large. Not
  // the -code-verifier cookie, which must survive until the email link is opened.
  const isSessionCookie = (name: string) => /^sb-.+-auth-token(\.\d+)?$/.test(name);
  const hadSession = req.cookies.getAll().some((c) => isSessionCookie(c.name));
  const toSet: { name: string; value: string; options: CookieOpts }[] = [];

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const c of list) {
          req.cookies.set(c.name, c.value);        // later server code sees the fresh token
          toSet.push(c);
        }
      },
    },
  });

  let viewer: Viewer | null = null;
  let user: { id: string; email?: string; email_confirmed_at?: string | null } | null = null;
  if (hadSession) {
    // getUser() asks Supabase Auth to confirm the session (one network round trip). The
    // profile read is started at the same time using the user id in the session cookie, so
    // the two round trips overlap. The profile is only used if getUser() confirms that same
    // id; otherwise it is read again for the confirmed user. The cookie id is never trusted.
    const { data: { session } } = await supabase.auth.getSession();
    const profileOf = (id: string) => supabase.from("profiles")
      .select("full_name, email, role, approval_status, business_name")
      .eq("id", id).maybeSingle();
    const hinted = subjectOf(session?.access_token);
    const [{ data }, early] = await Promise.all([
      supabase.auth.getUser(),
      hinted ? profileOf(hinted) : Promise.resolve(null),
    ]);
    user = data.user;
    if (user) {
      const { data: p } = early && hinted === user.id ? early : await profileOf(user.id);
      viewer = {
        id: user.id,
        email: user.email ?? p?.email ?? "",
        name: p?.full_name ?? (user.email ?? "").split("@")[0],
        role: p?.role ?? null,
        approval: p?.approval_status ?? null,
        emailVerified: Boolean(user.email_confirmed_at),
        businessName: p?.business_name ?? null,
      };
    }
  }

  const d = decide(req.nextUrl.pathname, viewer, hadSession, req.nextUrl.search);
  let res: NextResponse;
  if (d.type === "redirect") {
    res = NextResponse.redirect(new URL(d.to, req.url));
  } else {
    const headers = new Headers(req.headers);
    headers.delete(VIEWER_HEADER);
    if (viewer) headers.set(VIEWER_HEADER, encodeURIComponent(JSON.stringify(viewer)));
    res = NextResponse.next({ request: { headers } });
  }
  for (const { name, value, options } of toSet) res.cookies.set(name, value, hardenCookie(options, remember));
  // A stale session: clear the leftovers so the next request starts clean.
  if (!user && hadSession && toSet.length === 0) {
    for (const c of req.cookies.getAll()) {
      if (isSessionCookie(c.name)) res.cookies.set(c.name, "", { path: "/", maxAge: 0 });
    }
  }
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

export const config = {
  // Not for static files, images or the backend proxy (which checks the session itself).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|proxy/|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)"],
};
