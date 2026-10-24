// Form validation shared by the browser (instant feedback) and the server actions (the
// check that counts). Supabase and the database apply their own rules again.

export type AccountType = "supplier" | "buyer" | "adviser";
export const ACCOUNT_TYPES: AccountType[] = ["supplier", "buyer", "adviser"];

export const ADVISER_ROLES = [
  "Chartered Accountant",
  "Lawyer / Advocate",
  "Company Secretary",
  "Financial adviser",
  "MSME facilitation officer",
  "Other",
] as const;

export interface RegistrationInput {
  accountType: string;
  fullName: string;
  businessName: string;
  email: string;
  mobile: string;
  password: string;
  confirmPassword: string;
  businessAddress: string;
  udyam: string;
  professionalRole: string;
  qualifications: string;
}

export type FieldErrors = Partial<Record<keyof RegistrationInput | "form", string>>;

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim()) && s.trim().length <= 254;

/** Indian mobile numbers: 10 digits starting 6-9, with optional +91 / 91 / 0 prefix. */
export function normalizeMobile(s: string): string | null {
  const digits = s.replace(/[\s\-().]/g, "");
  const m = /^(?:\+?91|0)?([6-9]\d{9})$/.exec(digits);
  return m ? `+91${m[1]}` : null;
}

export function normalizeUdyam(s: string): string | null {
  const u = s.trim().toUpperCase();
  return /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/.test(u) ? u : null;
}

/** null when the password is acceptable. 72 is bcrypt's limit, which Supabase uses. */
export function passwordProblem(p: string): string | null {
  if (p.length < 8) return "Use at least 8 characters.";
  if (p.length > 72) return "Use 72 characters or fewer.";
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return "Use at least one letter and one number.";
  return null;
}

export function validateSignIn(email: string, password: string): FieldErrors {
  const e: FieldErrors = {};
  if (!email.trim()) e.email = "Enter your email address.";
  else if (!isEmail(email)) e.email = "Enter a valid email address, like name@company.com.";
  if (!password) e.password = "Enter your password.";
  return e;
}

export function validateRegistration(v: RegistrationInput): FieldErrors {
  const e: FieldErrors = {};
  const type = v.accountType as AccountType;
  if (!ACCOUNT_TYPES.includes(type)) e.accountType = "Choose an account type.";

  const name = v.fullName.trim();
  if (name.length < 2) e.fullName = "Enter your full name.";
  else if (name.length > 100) e.fullName = "Use 100 characters or fewer.";

  if (type !== "adviser" && !v.businessName.trim()) e.businessName = "Enter your business name.";
  else if (v.businessName.trim().length > 150) e.businessName = "Use 150 characters or fewer.";

  if (!v.email.trim()) e.email = "Enter your email address.";
  else if (!isEmail(v.email)) e.email = "Enter a valid email address, like name@company.com.";

  if (!v.mobile.trim()) e.mobile = "Enter your mobile number.";
  else if (!normalizeMobile(v.mobile)) e.mobile = "Enter a 10-digit Indian mobile number, like 98765 43210.";

  const pw = passwordProblem(v.password);
  if (pw) e.password = pw;
  if (!v.confirmPassword) e.confirmPassword = "Re-enter your password.";
  else if (v.password !== v.confirmPassword) e.confirmPassword = "The passwords don't match.";

  if (type === "supplier" || type === "buyer") {
    if (!v.businessAddress.trim()) e.businessAddress = "Enter your business address.";
    else if (v.businessAddress.trim().length > 300) e.businessAddress = "Use 300 characters or fewer.";
  }
  if (type === "supplier" && v.udyam.trim() && !normalizeUdyam(v.udyam)) {
    e.udyam = "Use the format UDYAM-KA-01-1234567, or leave it empty for now.";
  }
  if (type === "adviser") {
    if (!v.professionalRole.trim()) e.professionalRole = "Choose your professional role.";
    if (!v.qualifications.trim()) e.qualifications = "Enter your qualifications, such as ICAI membership.";
    else if (v.qualifications.trim().length > 300) e.qualifications = "Use 300 characters or fewer.";
  }
  return e;
}

export function validateNewPassword(password: string, confirm: string): FieldErrors {
  const e: FieldErrors = {};
  const pw = passwordProblem(password);
  if (pw) e.password = pw;
  if (!confirm) e.confirmPassword = "Re-enter your new password.";
  else if (password !== confirm) e.confirmPassword = "The passwords don't match.";
  return e;
}
