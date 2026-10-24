# End-to-end sign-in tests (test harness only)

`auth_flows.js` drives a real browser through every sign-in and role flow: register each
account type, verify by email link, sign in, typed URLs for other roles, the backend proxy,
cookie flags, expired sessions, remember me, sign out, adviser approval by an admin,
password reset and the phone layout. 59 checks.

It runs against a **stand-in** for Supabase, because Supabase's own auth server could not
be run in the environment where this was built:

| Piece | Real or stand-in |
|---|---|
| Postgres with `supabase/migrations/001-003` (trigger, grants, RLS, `review_adviser`) | Real (Postgres 16) |
| `supabase/tests/supabase_stub.sql`: `auth.users`, `auth.uid()`, roles `anon` / `authenticated` | Minimal copy of what Supabase provides |
| Auth API (sign-up, verify, token, user, logout, recover, resend) | `standin_supabase.py`, imitating Supabase Auth's responses |
| REST API (select, rpc) | `standin_supabase.py`, running each query as `authenticated` with the caller's JWT claims, like PostgREST |
| Backend | The real FastAPI app with `AUTH_MODE=supabase` (`backend_e2e.py` only swaps in Postgres for reading `profiles`) |
| Frontend | The real production build |

So it proves the app's own flows, redirects, cookies and role checks, and the database
rules. It does **not** prove anything about Supabase's service itself; run the manual check
in the root README (step 7) on the real project.

## Run

```bash
# Postgres 15+ running locally; create a database and apply the migrations
createdb ls03_e2e
for f in supabase/tests/supabase_stub.sql supabase/migrations/00{1,2,3}_*.sql; do psql -d ls03_e2e -f $f; done

export STANDIN_DB=postgresql://postgres@127.0.0.1:5432/ls03_e2e JWT_SECRET=e2e-secret-at-least-32-characters-long
cd e2e
uvicorn standin_supabase:app --port 54321 &
PYTHONPATH=../backend uvicorn backend_e2e:app --port 8000 &
cd ../frontend
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=standin-anon-key \
  NEXT_PUBLIC_SITE_URL=http://localhost:3000 npm run build
BACKEND_URL=http://127.0.0.1:8000 npm start &
cd .. && node e2e/auth_flows.js ./screenshots     # needs puppeteer-core and @sparticuz/chromium (npm)
```

Needs `pip install psycopg[binary] pyjwt fastapi uvicorn`. Rebuild the frontend without the
Supabase variables afterwards to return to demo mode.
