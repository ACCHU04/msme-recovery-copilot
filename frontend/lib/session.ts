// Demo sign-in only. No password is checked and nothing is sent to a server.
// Real sign-in (Supabase) replaces this: store the session there and call setAuthToken().
export interface DemoSession { name: string; email: string }

const KEY = "ls03.demoSession";

function read(store: Storage | undefined): DemoSession | null {
  try {
    const raw = store?.getItem(KEY);
    return raw ? (JSON.parse(raw) as DemoSession) : null;
  } catch {
    return null;
  }
}

export function getSession(): DemoSession | null {
  if (typeof window === "undefined") return null;
  return read(window.localStorage) ?? read(window.sessionStorage);
}

export function signIn(s: DemoSession, remember: boolean) {
  try {
    (remember ? window.localStorage : window.sessionStorage).setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: session lasts for this page only */
  }
}

export function signOut() {
  try {
    window.localStorage.removeItem(KEY);
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "U";
}
