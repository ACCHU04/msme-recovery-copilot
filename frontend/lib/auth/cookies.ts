// Session cookies are set only by the Next.js server and are HttpOnly, so page scripts
// (and anything injected into them) cannot read the tokens. Nothing is kept in
// localStorage. SameSite=Lax stops other sites from sending them on POST requests.

export const REMEMBER_COOKIE = "ls03-remember";
export const REMEMBER_DAYS = 30;

export interface CookieOpts {
  domain?: string;
  path?: string;
  maxAge?: number;
  expires?: Date | number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: boolean | "lax" | "strict" | "none";
  priority?: "low" | "medium" | "high";
  partitioned?: boolean;
}

export const secureCookies = () =>
  process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production";

/** Harden Supabase's cookie options. Without "remember me" the session ends when the
 *  browser closes (no Max-Age). Deletions (Max-Age 0) are always passed through. */
export function hardenCookie(options: (Omit<CookieOpts, "expires"> & { expires?: Date | number | string }) | undefined,
                             remember: boolean): CookieOpts {
  const { expires, ...rest } = options ?? {};
  const o: CookieOpts = { ...rest, httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/" };
  if (expires !== undefined) o.expires = typeof expires === "string" ? new Date(expires) : expires;
  const expiresAt = o.expires === undefined ? undefined : new Date(o.expires).getTime();
  const deleting = o.maxAge === 0 || (expiresAt !== undefined && expiresAt <= Date.now());
  if (!remember && !deleting) {
    delete o.maxAge;
    delete o.expires;
  }
  if (remember && !deleting && o.maxAge !== undefined) o.maxAge = Math.min(o.maxAge, REMEMBER_DAYS * 86400);
  return o;
}

export function rememberCookie(remember: boolean): [string, string, CookieOpts] {
  return [REMEMBER_COOKIE, remember ? "1" : "0", {
    httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/",
    ...(remember ? { maxAge: REMEMBER_DAYS * 86400 } : {}),
  }];
}
