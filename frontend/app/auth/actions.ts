"use server";

// Every Supabase Auth call runs here, on the server. Passwords go straight from the form to
// Supabase (which stores only a bcrypt hash); this app never stores or logs them.
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { destination, safeNext } from "@/lib/auth/access";
import { authEnabled } from "@/lib/auth/config";
import { rememberCookie, REMEMBER_COOKIE } from "@/lib/auth/cookies";
import { loadProfile, siteOrigin, supabaseServer } from "@/lib/auth/server";
import {
  isEmail, normalizeMobile, normalizeUdyam, validateNewPassword, validateRegistration, validateSignIn,
  type FieldErrors, type RegistrationInput,
} from "@/lib/auth/validation";

export interface FormState {
  error?: string;
  message?: string;
  fieldErrors?: FieldErrors;
  values?: Record<string, string>;
}

const NOT_CONFIGURED: FormState = {
  error: "Sign-in is not configured. Add the Supabase URL and anon key to .env.local (see README).",
};
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

type AuthErr = { status?: number; code?: string; message?: string } | null;
const rateLimited = (e: AuthErr) => e?.status === 429 || (e?.code ?? "").includes("rate_limit");

// ------------------------------------------------------------------ sign in

export async function signInAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!authEnabled) return NOT_CONFIGURED;
  const email = str(fd, "email").toLowerCase();
  const password = String(fd.get("password") ?? "");
  const remember = fd.get("remember") === "on";
  const next = safeNext(str(fd, "next"));
  const values = { email };

  const fieldErrors = validateSignIn(email, password);
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };

  const [name, value, options] = rememberCookie(remember);
  (await cookies()).set(name, value, options);
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.code === "email_not_confirmed") redirect("/verify-email?reason=unverified");
    if (rateLimited(error)) return { error: "Too many attempts. Wait a minute and try again.", values };
    if (error.code === "invalid_credentials" || error.status === 400) {
      return { error: "Email or password is incorrect.", values };
    }
    return { error: "We couldn't sign you in right now. Try again in a moment.", values };
  }
  const profile = await loadProfile(supabase, data.user.id);
  redirect(destination(profile && { role: profile.role, approval: profile.approval_status }, next));
}

// ------------------------------------------------------------------ register

export async function signUpAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!authEnabled) return NOT_CONFIGURED;
  const v: RegistrationInput = {
    accountType: str(fd, "accountType"),
    fullName: str(fd, "fullName"),
    businessName: str(fd, "businessName"),
    email: str(fd, "email").toLowerCase(),
    mobile: str(fd, "mobile"),
    password: String(fd.get("password") ?? ""),
    confirmPassword: String(fd.get("confirmPassword") ?? ""),
    businessAddress: str(fd, "businessAddress"),
    udyam: str(fd, "udyam"),
    professionalRole: str(fd, "professionalRole"),
    qualifications: str(fd, "qualifications"),
  };
  const { password: _p, confirmPassword: _c, ...safe } = v;   // never echo passwords back
  void _p; void _c;
  const values = safe as unknown as Record<string, string>;
  const fieldErrors = validateRegistration(v);
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };

  const type = v.accountType;
  // requested_role is a request only. The database trigger decides the real role and puts
  // advisers on "pending"; 'admin' can never be obtained this way (see migration 003).
  const metadata = {
    requested_role: type,
    full_name: v.fullName,
    business_name: v.businessName || null,
    mobile_number: normalizeMobile(v.mobile),
    business_address: type === "adviser" ? null : v.businessAddress,
    udyam_number: type === "supplier" ? normalizeUdyam(v.udyam) : null,
    professional_role: type === "adviser" ? v.professionalRole : null,
    qualifications: type === "adviser" ? v.qualifications : null,
  };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email: v.email,
    password: v.password,
    options: { data: metadata, emailRedirectTo: `${await siteOrigin()}/auth/callback` },
  });

  if (error) {
    if (error.code === "user_already_exists" || error.code === "email_exists") {
      return { fieldErrors: { email: "An account with this email already exists. Sign in instead." }, values };
    }
    if (error.code === "weak_password") {
      return { fieldErrors: { password: error.message || "Choose a stronger password." }, values };
    }
    if (rateLimited(error)) return { error: "Too many sign-ups right now. Wait a few minutes and try again.", values };
    if (error.code === "signup_disabled") return { error: "New sign-ups are turned off for this project.", values };
    return { error: "We couldn't create your account right now. Try again in a moment.", values };
  }

  // If the project has email confirmation turned off, Supabase signs the user in at once.
  // The app still refuses unverified users in middleware, so keep confirmation on.
  if (data.session && data.user) {
    const profile = await loadProfile(supabase, data.user.id);
    redirect(destination(profile && { role: profile.role, approval: profile.approval_status }));
  }
  redirect(`/registered?type=${encodeURIComponent(type)}`);
}

// ------------------------------------------------------------------ verification emails

export async function resendVerificationAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!authEnabled) return NOT_CONFIGURED;
  const email = str(fd, "email").toLowerCase();
  if (!isEmail(email)) return { fieldErrors: { email: "Enter the email address you registered with." }, values: { email } };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.resend({
    type: "signup", email, options: { emailRedirectTo: `${await siteOrigin()}/auth/callback` },
  });
  if (rateLimited(error)) return { error: "A link was sent recently. Wait a minute before asking again.", values: { email } };
  // Same answer whether or not the address has an account, so this can't be used to probe emails.
  return { message: "If that address has an account waiting for verification, a new link is on its way.", values: { email } };
}

// ------------------------------------------------------------------ password reset

export async function forgotPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!authEnabled) return NOT_CONFIGURED;
  const email = str(fd, "email").toLowerCase();
  if (!isEmail(email)) return { fieldErrors: { email: "Enter a valid email address." }, values: { email } };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await siteOrigin()}/auth/callback?next=/reset-password`,
  });
  if (rateLimited(error)) return { error: "A reset link was sent recently. Wait a minute before asking again.", values: { email } };
  return { message: "If an account exists for that email, we've sent a link to reset your password. It works once and expires after a short time.", values: { email } };
}

export async function updatePasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!authEnabled) return NOT_CONFIGURED;
  const password = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirmPassword") ?? "");
  const fieldErrors = validateNewPassword(password, confirm);
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your reset link has expired. Request a new one." };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "same_password") return { fieldErrors: { password: "Choose a password different from your current one." } };
    if (error.code === "weak_password") return { fieldErrors: { password: error.message || "Choose a stronger password." } };
    return { error: "We couldn't update your password. Request a new reset link and try again." };
  }
  await supabase.auth.signOut({ scope: "others" });   // other devices must sign in again
  const profile = await loadProfile(supabase, user.id);
  redirect(destination(profile && { role: profile.role, approval: profile.approval_status }));
}

// ------------------------------------------------------------------ sign out

export async function signOutAction(): Promise<void> {
  if (authEnabled) {
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
    (await cookies()).delete(REMEMBER_COOKIE);
  }
  redirect("/login?signed_out=1");
}

// ------------------------------------------------------------------ admin: adviser review

export async function reviewAdviserAction(_: FormState, fd: FormData): Promise<FormState> {
  if (!authEnabled) return NOT_CONFIGURED;
  const target = str(fd, "target");
  const decision = str(fd, "decision");
  const note = str(fd, "note").slice(0, 500);
  if (!/^[0-9a-f-]{36}$/i.test(target) || !["approved", "rejected"].includes(decision)) {
    return { error: "That request wasn't valid." };
  }
  const supabase = await supabaseServer();
  // The database function checks that the caller is an approved admin and logs the decision.
  const { error } = await supabase.rpc("review_adviser", { target, decision, note: note || null });
  if (error) {
    if (error.code === "42501") return { error: "Only an administrator can review advisers." };
    if (error.code === "P0002") return { error: "That adviser account no longer exists." };
    return { error: "The decision couldn't be saved. Try again." };
  }
  revalidatePath("/admin");
  return { message: decision === "approved" ? "Adviser approved." : "Adviser rejected." };
}
