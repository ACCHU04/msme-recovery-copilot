// Who may open which page. Pure functions: used by middleware.ts (the enforcement point
// for pages), by the sidebar (to hide links) and by the unit tests. The backend and the
// database enforce the same roles again for data, so hiding a link is never the only check.

export const ROLES = ["supplier", "buyer", "adviser", "admin"] as const;
export type Role = (typeof ROLES)[number];
export type Approval = "pending" | "approved" | "rejected";

export interface Viewer {
  id: string;
  email: string;
  name: string;
  role: Role | null;            // null: no profile row (should not happen; treated as denied)
  approval: Approval | null;
  emailVerified: boolean;
  businessName: string | null;
}

export const HOME: Record<Role, string> = {
  supplier: "/",
  buyer: "/buyer",
  adviser: "/adviser",
  admin: "/admin",
};

export const ROLE_LABEL: Record<Role, string> = {
  supplier: "MSME supplier",
  buyer: "Buyer / enterprise",
  adviser: "Adviser",
  admin: "Administrator",
};

const ALL: Role[] = [...ROLES];

/** Signed-out pages. A fully signed-in user is sent to their dashboard instead. */
const GUEST_PAGES = ["/login", "/register", "/forgot-password"];
/** Pages anyone may open, signed in or not. */
const OPEN_PAGES = ["/auth", "/registered", "/verify-email", "/access-denied", "/confirm"];

/** First match wins. "/" is handled separately (exact match only). */
const RULES: [prefix: string, roles: Role[]][] = [
  ["/profile", ["supplier"]],
  ["/contracts", ["supplier"]],
  ["/invoices", ["supplier"]],
  ["/cases", ["supplier"]],
  ["/assistant", ["supplier"]],
  ["/buyers", ["supplier"]],
  ["/reports", ["supplier"]],
  ["/buyer", ["buyer"]],
  ["/adviser", ["adviser", "admin"]],
  ["/admin", ["admin"]],
  ["/marketplace", ["supplier", "buyer", "admin"]],
  ["/legal", ALL],
  ["/settings", ALL],
];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + "/");

/** Roles allowed on a path, or null when the path has no rule (unknown pages render a 404). */
export function rolesFor(path: string): Role[] | null {
  if (path === "/") return ["supplier"];
  for (const [prefix, roles] of RULES) if (under(path, prefix)) return roles;
  return null;
}

export function canAccess(path: string, role: Role | null | undefined): boolean {
  if (!role) return false;
  const roles = rolesFor(path);
  return roles === null || roles.includes(role);
}

/** Only same-site relative paths, so ?next= can never send someone to another site. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  if (/[\r\n]/.test(next)) return null;
  return next;
}

export function isReady(v: Viewer | null): v is Viewer & { role: Role } {
  return !!v && v.emailVerified && !!v.role && v.approval === "approved";
}

/** Where to send someone right after they sign in or verify their email. */
export function destination(v: Pick<Viewer, "role" | "approval"> | null, next?: string | null): string {
  if (!v || !v.role) return "/access-denied?reason=profile";
  if (v.approval !== "approved") return "/pending-approval";
  const n = safeNext(next);
  if (n && !under(n, "/auth") && !GUEST_PAGES.some((p) => under(n, p)) && canAccess(n.split("?")[0], v.role)) return n;
  return HOME[v.role];
}

export type Decision = { type: "allow" } | { type: "redirect"; to: string };
const allow: Decision = { type: "allow" };
const go = (to: string): Decision => ({ type: "redirect", to });

/**
 * The page-level access decision for one request.
 * @param hadSession true when the request carried auth cookies (so a missing user means
 *                   the session expired or was revoked, not that they never signed in).
 */
export function decide(path: string, v: Viewer | null, hadSession = false, search = ""): Decision {
  if (OPEN_PAGES.some((p) => under(path, p))) return allow;

  if (GUEST_PAGES.some((p) => under(path, p))) {
    return isReady(v) ? go(HOME[v.role]) : allow;
  }

  if (!v) {
    if (path === "/reset-password") return go("/forgot-password?expired=1");
    const next = encodeURIComponent(path + search);
    return go(`/login?next=${next}${hadSession ? "&expired=1" : ""}`);
  }

  // A recovery link signs the user in just to choose a new password.
  if (path === "/reset-password") return allow;
  if (!v.emailVerified) return go("/verify-email");
  if (!v.role) return go("/access-denied?reason=profile");

  if (v.approval !== "approved") return path === "/pending-approval" ? allow : go("/pending-approval");
  if (path === "/pending-approval") return go(HOME[v.role]);

  if (path === "/") return v.role === "supplier" ? allow : go(HOME[v.role]);
  return canAccess(path, v.role) ? allow : go(`/access-denied?from=${encodeURIComponent(path)}`);
}
