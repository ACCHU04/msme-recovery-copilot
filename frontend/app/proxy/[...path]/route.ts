// Same-origin proxy to the FastAPI backend. The browser calls /proxy/api/...; this handler
// reads the session from the HttpOnly cookie and forwards the request with
// `Authorization: Bearer <access token>`. The backend verifies that token and the user's
// role itself, so this proxy adds no trust of its own.
import { NextResponse, type NextRequest } from "next/server";
import { authEnabled } from "@/lib/auth/config";
import { supabaseServer } from "@/lib/auth/server";

const BACKEND = (process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

const json = (status: number, detail: string) =>
  NextResponse.json({ detail }, { status, headers: { "Cache-Control": "no-store" } });

/** Cookie-authenticated writes must come from this site's own pages. */
function sameOrigin(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
    } catch {
      return false;
    }
  }
  return true;
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!authEnabled) return json(404, "Not found");
  const { path } = await ctx.params;
  if (path[0] !== "api" || path.some((s) => s === ".." || s === ".")) return json(404, "Not found");
  if (req.method !== "GET" && !sameOrigin(req)) return json(403, "Request blocked.");

  const supabase = await supabaseServer();
  const { data: { session } } = await supabase.auth.getSession();   // refreshes if expired
  if (!session) return json(401, "Your session expired. Sign in again.");

  const target = `${BACKEND}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${session.access_token}`, Accept: "application/json" };
  const contentType = req.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;
  try {
    const r = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),   // binary-safe (file uploads)
      cache: "no-store",
      signal: AbortSignal.timeout(req.nextUrl.pathname.includes("/documents/") ? 60000 : 30000),
    });
    // Bytes, not text: responses can be files (the PDF evidence pack).
    const out: Record<string, string> = { "Content-Type": r.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" };
    const disposition = r.headers.get("content-disposition");
    if (disposition) out["Content-Disposition"] = disposition;
    return new NextResponse(r.status === 204 ? null : await r.arrayBuffer(), { status: r.status, headers: out });
  } catch {
    return json(502, "Can't reach the server. Check that the backend is running.");
  }
}

export { handle as DELETE, handle as GET, handle as PATCH, handle as POST, handle as PUT };
