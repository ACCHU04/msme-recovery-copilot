// Where links in Supabase emails land (verify email, reset password). Exchanges the one-time
// code for a session cookie, then sends the person to the right page for their role.
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { destination, safeNext } from "@/lib/auth/access";
import { authEnabled } from "@/lib/auth/config";
import { loadProfile, supabaseServer } from "@/lib/auth/server";

const OTP_TYPES: EmailOtpType[] = ["signup", "recovery", "email", "invite", "magiclink", "email_change"];

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const to = (path: string) => NextResponse.redirect(new URL(path, req.url));
  if (!authEnabled) return to("/login");

  const next = safeNext(q.get("next"));
  const recovering = next === "/reset-password" || q.get("type") === "recovery";
  if (q.get("error") || q.get("error_code")) {
    return to(recovering ? "/forgot-password?expired=1" : "/login?link=expired");
  }

  const supabase = await supabaseServer();
  const code = q.get("code");
  const tokenHash = q.get("token_hash");
  const type = q.get("type") as EmailOtpType | null;
  let ok = false;
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && type && OTP_TYPES.includes(type)) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  }
  if (!ok) {
    // With the code flow, Supabase has usually verified the email before redirecting here;
    // the exchange fails if the link is opened in a different browser.
    return to(recovering ? "/forgot-password?expired=1" : "/login?link=other-browser");
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return to("/login?link=expired");
  if (recovering) return to("/reset-password");
  const p = await loadProfile(supabase, user.id);
  return to(destination(p && { role: p.role, approval: p.approval_status }, next));
}
