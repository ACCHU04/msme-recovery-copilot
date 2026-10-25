# Deploying Settle45 so it opens fast

Most slowness comes from three things, not from the code: running in development mode, parts
of the app sitting on different continents, and a backend that sleeps when idle. This guide
fixes all three.

## The rule: put every part in or next to India

| Part | Where | Why |
|---|---|---|
| Supabase (database + auth) | **Mumbai, `ap-south-1`** | Chosen when the project is created; it cannot be moved later. If yours is elsewhere, create a new project in Mumbai and re-run the migrations |
| Frontend (Next.js) on **Vercel** | Server code in **`bom1` (Mumbai)**, set by `frontend/vercel.json` | Vercel runs server code (sign-in checks, the API proxy) in **Washington D.C. (`iad1`) by default**, which adds a round trip to the USA on every page |
| Backend (FastAPI) on **Fly.io** | **`bom` (Mumbai)**, always on (`backend/fly.toml`) | Same city as Supabase and Vercel's functions |
| or Backend on **Render** | **Singapore** (Render has no India region), paid instance (`render.yaml`) | Nearest Render region; free instances sleep |

Measured locally, every API call takes under 25 ms. With all parts in Mumbai, each page needs
only a few short hops inside one city, instead of trips to the USA.

## Step by step

### 1. Supabase (Mumbai)
1. New project → Region **South Asia (Mumbai)**.
2. SQL Editor: run `supabase/migrations/001` … `007` in order (**007 is the big speed-up**: one round trip per page instead of eight), then `supabase/seed.sql` (optional demo data).
3. Authentication → URL configuration: Site URL = your Vercel address; add `https://<your-site>/auth/callback` to the redirect URLs.
4. Note the Project URL, anon key and service-role key (Project Settings → API).

### 2. Backend on Fly.io (Mumbai, recommended)
```bash
cd backend
fly launch --no-deploy --copy-config          # choose a unique app name; keep region bom
fly secrets set STORE=supabase \
  SUPABASE_URL=https://xxxx.supabase.co \
  SUPABASE_SERVICE_KEY=... \
  CORS_ORIGINS=https://your-site.vercel.app \
  GEMINI_API_KEY=...                           # optional
fly deploy
curl https://<app>.fly.dev/api/health          # {"ok":true,"store":"supabase",...}
```
`fly.toml` keeps one machine always running (`auto_stop_machines = "off"`), so the first
request is never a cold start. If Mumbai is not offered to your account, set
`primary_region = "sin"` (Singapore).

**Alternative: Render.** New → Blueprint → pick this repo; `render.yaml` creates the service in
Singapore on a paid "starter" instance. Fill in the secret values in the Render dashboard.

### 3. Frontend on Vercel (Mumbai functions)
1. Import the repo → Root directory **`frontend`**. `vercel.json` already sets `"regions": ["bom1"]`.
2. Environment variables (Production):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public by design) |
| `NEXT_PUBLIC_SITE_URL` | `https://your-site.vercel.app` |
| `BACKEND_URL` | `https://<app>.fly.dev` (server-side only) |

3. Deploy. Check in Vercel → Project → Settings → Functions that the region shows **Mumbai (bom1)**.

Never put `SUPABASE_SERVICE_KEY` or `GEMINI_API_KEY` in Vercel: they belong only to the backend.

### 4. Check it is fast
- Open the site in a private window, sign in, and open the dashboard twice: the second time should be near-instant (the app caches reads for 20 s).
- Browser DevTools → Network: `/proxy/api/...` calls should take well under a second.
- `curl -w "%{time_total}\n" -o /dev/null -s https://<app>.fly.dev/api/health` from India: tens of milliseconds, not seconds.

## For a demo without any accounts
Run the backend in demo mode with **one worker** (each worker would otherwise hold its own
copy of the in-memory demo data):
```bash
fly secrets set STORE=memory WEB_CONCURRENCY=1    # or locally:
cd backend && STORE=memory uvicorn app.main:app --port 8000
cd frontend && npm run build && npm start         # never `npm run dev` for a demo
```
Leave the `NEXT_PUBLIC_SUPABASE_*` variables empty so the frontend runs in demo mode.

## Why each change helps

| Problem | Cost | Fix in this repo |
|---|---|---|
| `npm run dev` compiles each page on first open | 7 s first page, about 1 s each new page (measured) | Use `npm run build && npm start` |
| Vercel functions in the USA by default | A trip to the USA on every page check and API call | `frontend/vercel.json` → `bom1` |
| Free hosting sleeps when idle | First request after idle can take tens of seconds | Fly always-on machine / Render paid instance |
| Backend far from Supabase | Every database query crosses regions | Backend and Supabase both in Mumbai |
| Repeated loads of the same data | Same lists fetched again on every page | 20 s read cache, parallel queries, no saves while browsing (already in the code) |
| 8 database queries per page | 3 rounds of round trips | `business_bundle()` (migration 007): **1** round trip; falls back to the queries if 007 is missing |
| Role re-read on every API call | 1 round trip per request | Profile and business cached 30 s per user in the backend |
| Dashboard asked the backend twice | 2 full data loads | `GET /api/dashboard`: one load, shared with the alerts bell |
| Sidebar links pre-loaded in the background | Each ran the sign-in check: 26 Supabase calls on opening the dashboard | Sidebar prefetch off: 4 calls |
| Uncompressed JSON | about 17 KB per dashboard | gzip: about 3 KB |

Measured with 150 ms added to every database call: dashboard data **804 ms → 200 ms** (20 round trips → 1).
