import { describe, expect, it } from "vitest";
import { canAccess, decide, destination, safeNext, type Role, type Viewer } from "@/lib/auth/access";
import { hardenCookie } from "@/lib/auth/cookies";
import { normalizeMobile, normalizeUdyam, passwordProblem, validateRegistration, type RegistrationInput } from "@/lib/auth/validation";

const viewer = (role: Role | null, over: Partial<Viewer> = {}): Viewer => ({
  id: "u1", email: "a@b.co", name: "A", role, approval: "approved", emailVerified: true, businessName: null, ...over,
});

describe("route access by role", () => {
  const SUPPLIER_PAGES = ["/", "/profile", "/contracts", "/contracts/x", "/invoices/1", "/cases/c/report", "/assistant", "/buyers", "/reports"];

  it("suppliers get the supplier pages and nothing role-specific to others", () => {
    for (const p of SUPPLIER_PAGES) expect(canAccess(p, "supplier"), p).toBe(true);
    for (const p of ["/buyer", "/adviser", "/admin"]) expect(canAccess(p, "supplier"), p).toBe(false);
  });

  it("other roles cannot open supplier pages by typing the URL", () => {
    for (const role of ["buyer", "adviser", "admin"] as Role[]) {
      for (const p of SUPPLIER_PAGES.filter((x) => x !== "/")) {
        expect(decide(p, viewer(role))).toEqual({ type: "redirect", to: `/access-denied?from=${encodeURIComponent(p)}` });
      }
    }
  });

  it("'/buyer' is not confused with '/buyers'", () => {
    expect(canAccess("/buyer", "buyer")).toBe(true);
    expect(canAccess("/buyers", "buyer")).toBe(false);
    expect(canAccess("/buyers", "supplier")).toBe(true);
  });

  it("each role lands on its own dashboard from '/'", () => {
    expect(decide("/", viewer("supplier"))).toEqual({ type: "allow" });
    expect(decide("/", viewer("buyer"))).toEqual({ type: "redirect", to: "/buyer" });
    expect(decide("/", viewer("adviser"))).toEqual({ type: "redirect", to: "/adviser" });
    expect(decide("/", viewer("admin"))).toEqual({ type: "redirect", to: "/admin" });
  });

  it("shared pages", () => {
    for (const r of ["supplier", "buyer", "adviser", "admin"] as Role[]) {
      expect(canAccess("/legal", r)).toBe(true);
      expect(canAccess("/settings", r)).toBe(true);
    }
    expect(canAccess("/marketplace", "adviser")).toBe(false);
    expect(canAccess("/admin", "adviser")).toBe(false);
  });
});

describe("decide: sign-in states", () => {
  it("signed-out visitors go to login with a return path", () => {
    expect(decide("/invoices/7", null, false, "?tab=x")).toEqual({ type: "redirect", to: "/login?next=%2Finvoices%2F7%3Ftab%3Dx" });
  });

  it("an expired session says so", () => {
    expect(decide("/contracts", null, true)).toEqual({ type: "redirect", to: "/login?next=%2Fcontracts&expired=1" });
  });

  it("unverified email is sent to verify, whatever the role", () => {
    expect(decide("/", viewer("supplier", { emailVerified: false }))).toEqual({ type: "redirect", to: "/verify-email" });
  });

  it("pending and rejected advisers only see the pending page", () => {
    for (const approval of ["pending", "rejected"] as const) {
      const v = viewer("adviser", { approval });
      expect(decide("/adviser", v)).toEqual({ type: "redirect", to: "/pending-approval" });
      expect(decide("/legal", v)).toEqual({ type: "redirect", to: "/pending-approval" });
      expect(decide("/pending-approval", v)).toEqual({ type: "allow" });
    }
    expect(decide("/pending-approval", viewer("adviser"))).toEqual({ type: "redirect", to: "/adviser" });
  });

  it("a user without a profile is denied", () => {
    expect(decide("/", viewer(null, { approval: null }))).toEqual({ type: "redirect", to: "/access-denied?reason=profile" });
  });

  it("signed-in users skip the login page; others may use it", () => {
    expect(decide("/login", viewer("buyer"))).toEqual({ type: "redirect", to: "/buyer" });
    expect(decide("/login", null)).toEqual({ type: "allow" });
    expect(decide("/register", viewer("adviser", { approval: "pending" }))).toEqual({ type: "allow" });
  });

  it("reset-password needs the session from the email link", () => {
    expect(decide("/reset-password", null)).toEqual({ type: "redirect", to: "/forgot-password?expired=1" });
    expect(decide("/reset-password", viewer("adviser", { approval: "pending" }))).toEqual({ type: "allow" });
  });

  it("open pages stay open", () => {
    for (const p of ["/auth/callback", "/registered", "/verify-email", "/access-denied"]) expect(decide(p, null)).toEqual({ type: "allow" });
  });
});

describe("redirect safety", () => {
  it("only accepts same-site paths", () => {
    expect(safeNext("/invoices/1")).toBe("/invoices/1");
    for (const bad of ["https://evil.test", "//evil.test", "/\\evil.test", "invoices", "", null, "/a\r\nSet-Cookie: x"]) {
      expect(safeNext(bad as string | null)).toBeNull();
    }
  });

  it("never sends a user to a page their role can't open", () => {
    expect(destination({ role: "buyer", approval: "approved" }, "/invoices")).toBe("/buyer");
    expect(destination({ role: "supplier", approval: "approved" }, "/invoices/9")).toBe("/invoices/9");
    expect(destination({ role: "supplier", approval: "approved" }, "//evil.test")).toBe("/");
    expect(destination({ role: "supplier", approval: "approved" }, "/login")).toBe("/");
    expect(destination({ role: "adviser", approval: "pending" }, "/adviser")).toBe("/pending-approval");
    expect(destination(null)).toBe("/access-denied?reason=profile");
  });
});

describe("session cookies", () => {
  it("are HttpOnly and SameSite=Lax", () => {
    const o = hardenCookie({ maxAge: 400 * 86400, httpOnly: false, sameSite: "none" }, true);
    expect(o.httpOnly).toBe(true);
    expect(o.sameSite).toBe("lax");
    expect(o.maxAge).toBe(30 * 86400);   // capped at 30 days
  });

  it("end with the browser session unless remembered", () => {
    const o = hardenCookie({ maxAge: 3600, expires: new Date(Date.now() + 3600e3) }, false);
    expect(o.maxAge).toBeUndefined();
    expect(o.expires).toBeUndefined();
  });

  it("still delete properly", () => {
    expect(hardenCookie({ maxAge: 0 }, false).maxAge).toBe(0);
  });
});

describe("registration validation", () => {
  const base: RegistrationInput = {
    accountType: "supplier", fullName: "Rajesh Sharma", businessName: "Sri Lakshmi Packaging", email: "r@example.com",
    mobile: "98765 43210", password: "packaging42", confirmPassword: "packaging42", businessAddress: "Peenya, Bengaluru",
    udyam: "", professionalRole: "", qualifications: "",
  };

  it("accepts a complete supplier", () => expect(validateRegistration(base)).toEqual({}));

  it("normalises Indian mobile numbers", () => {
    expect(normalizeMobile("+91 98765-43210")).toBe("+919876543210");
    expect(normalizeMobile("09876543210")).toBe("+919876543210");
    expect(normalizeMobile("12345 67890")).toBeNull();
    expect(normalizeMobile("98765")).toBeNull();
  });

  it("checks passwords", () => {
    expect(passwordProblem("short1")).toMatch(/8/);
    expect(passwordProblem("onlyletters")).toMatch(/letter and one number/);
    expect(passwordProblem("a".repeat(72) + "1")).toMatch(/72/);
    expect(validateRegistration({ ...base, confirmPassword: "different1" }).confirmPassword).toMatch(/match/);
  });

  it("Udyam is optional but must be well formed", () => {
    expect(normalizeUdyam("udyam-ka-01-1234567")).toBe("UDYAM-KA-01-1234567");
    expect(validateRegistration({ ...base, udyam: "UDYAM-1" }).udyam).toBeTruthy();
  });

  it("asks each account type for its own fields", () => {
    expect(validateRegistration({ ...base, accountType: "buyer", businessAddress: "" }).businessAddress).toBeTruthy();
    const adviser = validateRegistration({ ...base, accountType: "adviser", businessName: "", businessAddress: "" });
    expect(adviser.businessName).toBeUndefined();
    expect(adviser.businessAddress).toBeUndefined();
    expect(adviser.professionalRole).toBeTruthy();
    expect(adviser.qualifications).toBeTruthy();
  });

  it("rejects unknown account types such as admin", () => {
    expect(validateRegistration({ ...base, accountType: "admin" }).accountType).toBeTruthy();
  });
});

describe("public confirmation page (C4)", () => {
  it("is open to signed-out visitors and to every role", () => {
    expect(decide("/confirm/abc123", null)).toEqual({ type: "allow" });
    expect(decide("/confirm/abc123", null, true)).toEqual({ type: "allow" });
  });
});

describe("cash flow page", () => {
  it("is for suppliers only", () => {
    expect(canAccess("/cashflow", "supplier")).toBe(true);
    for (const r of ["buyer", "adviser", "admin"] as Role[]) expect(canAccess("/cashflow", r)).toBe(false);
  });
});
