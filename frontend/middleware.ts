// Runs on the server before every page. When Supabase is configured it:
//  1. refreshes the session cookie if the access token has expired,
//  2. reads their profile (role, approval) with their token; Supabase rejects a forged or
//     expired token there, so this one call also proves who they are (cached 30 s),
//  4. redirects according to lib/auth/access.ts (sign-in, verify email, pending approval,
//     access denied, or their own dashboard),
//  5. passes the viewer to the layout in a request header it sets itself (any incoming
//     header with that name is removed first, so it cannot be forged).
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { decide, type Viewer } from "@/lib/auth/access";
import { authEnabled, SUPABASE_ANON_KEY, SUPABASE_URL, VIEWER_HEADER } from "@/lib/auth/config";
import { hardenCookie, REMEMBER_COOKIE, type CookieOpts } from "@/lib/auth/cookies";

type Claims = { sub?: string; exp?: number; email?: string; user_metadata?: { email_verified?: boolean } };

/** Reads the token's payload. Not trusted on its own: the profile read below proves the token. */
function jwtClaims(token: string): Claims | null {
  try {
    const part = token.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))) as Claims;
  } catch {
    return null;
  }
}

// Per-instance cache of proven tokens. Keyed by the token itself, so a new sign-in or a
// refreshed token always reads the profile again; role or approval changes show within 30 s.
const VIEWER_TTL_MS = 30_000;
const viewerCache = new Map<string, { viewer: Viewer; until: number }>();
function remember_(token: string, viewer: Viewer) {
  if (viewerCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of viewerCache) if (v.until <= now) viewerCache.delete(k);
    if (viewerCache.size > 500) viewerCache.clear();
  }
  viewerCache.set(token, { viewer, until: Date.now() + VIEWER_TTL_MS });
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
  let tokenRejected = false;
  if (hadSession) {
    // getSession reads the cookie and only goes to the network to refresh an expired token.
    // The token is then proven by the profile read: Supabase's database API rejects a forged
    // or expired token, so a separate getUser() round trip is not needed. A proven token's
    // viewer is kept for 30 s, so moving between pages costs no Supabase call at all.
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const claims = token ? jwtClaims(token) : null;
    if (token && claims?.sub && (claims.exp ?? 0) * 1000 > Date.now()) {
      const cached = viewerCache.get(token);
      if (cached && cached.until > Date.now()) {
        viewer = cached.viewer;
      } else {
        const { data: p, error, status } = await supabase.from("profiles")
          .select("full_name, email, role, approval_status, business_name")
          .eq("id", claims.sub).maybeSingle();
        if (!error) {
          const email = claims.email ?? p?.email ?? "";
          viewer = {
            id: claims.sub,
            email,
            name: p?.full_name ?? email.split("@")[0],
            role: p?.role ?? null,
            approval: p?.approval_status ?? null,
            // Supabase issues no session before the email is confirmed (when confirmation is on).
            emailVerified: claims.user_metadata?.email_verified !== false,
            businessName: p?.business_name ?? null,
          };
          // Only settled accounts are kept: someone waiting for verification or approval is
          // re-checked on every page, so an approval shows at once.
          if (viewer.role && viewer.approval === "approved" && viewer.emailVerified) remember_(token, viewer);
        } else {
          tokenRejected = status === 401 || String(error.code ?? "").startsWith("PGRST3");
        }
      }
    } else {
      tokenRejected = true;
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
  if (!viewer && hadSession && tokenRejected && toSet.length === 0) {
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
