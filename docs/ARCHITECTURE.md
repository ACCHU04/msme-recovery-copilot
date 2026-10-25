# Settle45: system design and architecture

Layers 1–3 of the "plan" phase: what the parts are, how data moves, what breaks first, and
why each tool is in the stack.

## 1. System design

### Who uses it
| User | Main job |
|---|---|
| MSME supplier (micro or small, Udyam registered) | Know what a buyer owes by law, keep evidence, recover without losing the customer |
| Buyer | See invoices raised to it, legal pay-by dates and the cost of paying late |
| Adviser (CA / lawyer) | Review cases a supplier shares, read-only |
| Admin | Approve or reject adviser accounts |

### The system in five boxes

```
 ┌──────────────┐  HTTPS   ┌──────────────────────────┐  server-side  ┌──────────────────────┐
 │  Browser     │ ───────▶ │ Next.js server            │ ────────────▶ │ FastAPI backend       │
 │  (phone/PC)  │ ◀─────── │ pages, middleware, proxy  │ ◀──────────── │ engine · copilot · AI │
 └──────────────┘ cookies  └────────────┬─────────────┘  Bearer token  └──────┬─────────┬─────┘
                                        │ sign-in                             │         │
                                        ▼                                     ▼         ▼
                               ┌──────────────────┐                ┌──────────────┐ ┌──────────┐
                               │ Supabase Auth     │                │ Supabase      │ │ Gemini   │
                               └──────────────────┘                │ Postgres + RLS│ │(optional)│
                                                                   └──────────────┘ └──────────┘
```

### How data moves (one request)
1. The browser opens a page. **Middleware** confirms the session with Supabase Auth and the
   role from `profiles`, then redirects if the role may not open that page.
2. The page asks for data at `/proxy/api/...`. The **Next.js proxy** adds the user's access
   token (from an HttpOnly cookie), checks the request comes from our own site, and forwards it.
3. **FastAPI** verifies the token, loads the profile and business (in parallel), checks the role,
   then reads the case data from Postgres in 3 rounds of parallel queries.
4. The **recovery engine** (plain Python, no AI) works out acceptance, due dates and s.16
   interest; the **copilot** (rules) checks the case and picks the next step.
5. Only the legal Q&A and the document check call **Gemini**, and their output is checked in
   code before it is returned.

### What must never break
- Legal figures: amount owed, due date, interest. Tested to the paisa; AI never touches them.
- Access: one supplier must never see another's data (checked in middleware, backend and RLS).
- Sign-in and sign-out.

### What breaks first if traffic grows 10×
| Part | Why | Simplest fix |
|---|---|---|
| Supabase round trips per page | Each page does auth + 3–4 query rounds over the internet | Same region for backend and Supabase (ap-south-1); a single SQL view or RPC returning a case bundle |
| Case evaluation on every list | `GET /api/cases` recalculates every case | Cache the evaluation per case until its data changes |
| Gemini quota / cost | Paid API per question | Per-user limits already exist (8/min, 100/day); move the limiter to a shared store (Redis) when there is more than one backend copy |
| One backend process | Single Uvicorn worker | Run several workers or copies; the backend keeps no state except the AI rate limiter |

### When a part fails
| Failure | What the user sees |
|---|---|
| Gemini down or no key | Prepared answers from the reviewed knowledge base; document check says it is unavailable |
| Backend down | Friendly error with "Try again"; nothing is lost |
| Supabase Auth down | Cannot sign in; demo mode still works |
| Browser offline | A banner says so; buttons show an error instead of failing silently |

## 2. Architecture

**One frontend, one backend, one database. No microservices.**

| Part | Choice | Why |
|---|---|---|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS 4 | Pages plus a server-side proxy, so tokens and keys never reach browser code |
| Auth | Supabase Auth via `@supabase/ssr` | A trusted provider; sessions in HttpOnly cookies; email verification and reset built in |
| Backend | Python, FastAPI, Pydantic v2 | Exact decimal maths for money; every input validated |
| Legal engine | Plain Python modules (`recovery_engine`, `copilot`) | Deterministic and testable; the law must give the same answer every time |
| Database | Supabase Postgres with row-level security | Relations between cases, invoices, payments; the database itself enforces ownership |
| AI | Google Gemini (JSON mode) | Natural-language answers and document reading, with code checks on every output |
| Voice | Browser Web Speech API | Free, no server, English / Hindi / Kannada |

Hosting (suggested): frontend on Vercel, backend on Render or Railway, Supabase in Mumbai
(`ap-south-1`). Free tiers are enough for a pilot; move the backend to a paid always-on plan
to avoid cold starts.

### Folders
| Folder | What is in it |
|---|---|
| `frontend/app/` | One folder per page (dashboard, invoices, cases, legal, buyer, adviser, admin, login…) |
| `frontend/components/` | Shared UI: layout shell, assistant, case widgets, sharing, basic UI kit |
| `frontend/lib/` | API client (with short read cache), auth helpers, formatting, voice |
| `frontend/middleware.ts` | Sign-in and role check for every page |
| `backend/app/` | FastAPI app: routes, auth, storage, evaluation, drafts, AI modules |
| `backend/recovery_engine/` | MSMED Act rules: due dates, interest, rates, eligibility, settlement |
| `backend/copilot/` | Case checks, promise reading and tracking, next-step rules |
| `supabase/migrations/` | Every database change, in order (001–006) |
| `supabase/seed.sql` | Fictional demo data and the demo-accounts guide |
| `e2e/` | Browser tests of the sign-in flows |
| `docs/` | This file, the API table and the data notes |

## 3. Front end

| Screen state | How it is handled |
|---|---|
| Loading | `LoadingState` on every data page |
| Empty | `EmptyState` with what to do next (e.g. "Add an invoice") |
| Error | `ErrorState` with the message and a "Try again" button |
| Success | Toast messages after saves |
| No internet | `OfflineBanner` at the top of every page |
| Double clicks | Save buttons are disabled while their request runs |
| Phone (360 px) | Sidebar collapses to a menu; tables scroll sideways; checked in the e2e "mobile layout" test |
| Stale data | Read requests are cached for 20 s and the cache is cleared after any save |
