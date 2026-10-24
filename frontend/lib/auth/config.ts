// Supabase settings. Both are public by design (the anon / publishable key only works
// together with row level security). Never put the service-role key in the frontend.
export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** True when Supabase is configured: real sign-in, role checks and the backend proxy are on.
 *  False: the clearly labelled local demo mode (no accounts, backend AUTH_MODE=demo). */
export const authEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** Request header middleware.ts uses to hand the viewer to the root layout. */
export const VIEWER_HEADER = "x-ls03-viewer";
