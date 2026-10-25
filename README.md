# Settle45: MSME Payment Recovery Assistant (LS-03, Srujana Tech Fest 2026)

**Recovery Copilot**: helps a micro or small supplier decide what to do next about a
delayed payment under the MSMED Act, 2006, and why, without losing the customer. It
reconciles the case facts against each other and the evidence, tracks the buyer's payment
promises, and recommends one next step with its reasons, sources and alternatives. All amounts and legal
rules come from deterministic code (`backend/recovery_engine`, `backend/copilot`). AI is
used in one place only: the Legal Assistant answers typed questions with Google Gemini,
grounded in the team's MSMED Act texts and checked before it is shown (see "AI legal
assistant" below). It never calculates amounts, dates or eligibility.

> Estimates for information only. Not legal advice.

## Status

| Part | State |
|---|---|
| Calculation engine (eligibility, due dates, s.16 interest, settlement) | Done, tested |
| Backend API: profile, cases, invoices, payments, evidence, evaluate, settlement | Done, tested (in-memory store) |
| Supabase schema, RLS, seed data | Written; run on your project |
| Supabase store | Written; test against your project |
| Simulator endpoint | Stub with final shape; chat state machine is next (P3) |
| Auth: Supabase JWT verification, ownership from the token | Done, tested |
| Sign-in in the frontend: register (supplier / buyer / adviser), email verification, sign in, remember me, forgot / reset password, sign out | Done; tested end to end against a stand-in auth server (`e2e/`), **not yet against a real Supabase project** |
| Roles: `profiles` table, sign-up trigger, column grants, RLS, adviser approval, admin dashboard; role checks in middleware, backend and database | Done; database rules tested on real Postgres (30 tests), backend (227 tests) |
| Payment checks: running total vs amount owed, duplicate guard | Done, tested |
| Copilot: reconciliation findings, ODR readiness, promise tracker, next-action engine | Done, tested |
| Drafts: template-based, figures from the calculation (`POST /cases/{id}/drafts`) | Done, tested |
| Frontend (Next.js): login, dashboard, business profile, contracts and contract details, invoices and invoice details, recovery cases, assistant, legal assistant, buyer profile and payment performance, reports, settings | Done, tested (see `frontend/README.md`) |
| Marketplace (labelled sample data) and adviser portal (role preview of your own cases) | Preview only, no external service |
| Invoice list/detail, invoice edit and delete, payment delete, what-if calculator, rate table | Done, tested |
| Business profile details (contact, GSTIN/PAN, products, team list, document checklist), contract milestones, invoice notes (migration 004) | Done, tested |
| AI legal assistant (Gemini, grounded and checked, falls back to prepared answers), voice in/out | Done, tested with a simulated Gemini; **check once with your real key** |
| Floating Assistant on every page; AI document check (photo/PDF read by Gemini, compared with records in code) | Done, tested with a simulated Gemini; **check once with your real key** |
| Restyled UI: demo login, dashboard, business profile, invoices, invoice verification, legal assistant, buyer insights, recovery journey, Open in WhatsApp | Done, tested |
| Case sharing with advisers, buyer invoice linking, server PDF, Kannada drafts, document upload, WhatsApp Business API | To do |

## Run the frontend

See `frontend/README.md` (`npm install && npm run dev`, with the backend running).

## Run the backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m pytest -q                                   # 227 tests
uvicorn app.main:app --reload                         # http://127.0.0.1:8000/docs
```

With no environment variables it runs on the in-memory store, pre-loaded with the demo
case. This is also the offline fallback for the demo.

## Set up Supabase sign-in (step by step)

Without these steps the app runs in the labelled **demo mode** (no accounts). Do them once
per Supabase project; about 20 minutes.

**1. Create the project.** At supabase.com create a project (region: Mumbai). Keep the
database password somewhere safe.

**2. Create the tables and rules.** Dashboard → SQL Editor → run, in this order:
`supabase/migrations/001_init.sql`, `002_copilot.sql`, `003_auth_roles.sql`,
`004_profile_notes_milestones.sql`, then `supabase/seed.sql` (optional demo data). 003 creates `profiles`, `adviser_reviews`, the
sign-up trigger, column grants and row level security (explained below).

**3. Auth settings.** Dashboard → Authentication:
- *Sign In / Providers → Email*: enabled, **Confirm email on**. Keep the minimum password
  length at 8 or more to match the app.
- *URL Configuration*: Site URL `http://localhost:3000` (your deployed URL later). Redirect
  URLs: add `http://localhost:3000/auth/callback` and `https://YOUR-APP/auth/callback`.
- *Emails*: Supabase's built-in email service is for testing only and is limited (check the
  dashboard for the current rules; it may only deliver to your project team's addresses and
  only a few per hour). For anyone else to register, add your own SMTP server under
  *SMTP Settings*. The default templates work as they are.

**4. Keys.** Dashboard → Project Settings → API (and *JWT Keys*):
- Frontend `frontend/.env.local` (copy from `frontend/.env.example`):
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon / publishable key),
  `NEXT_PUBLIC_SITE_URL=http://localhost:3000`, `BACKEND_URL=http://127.0.0.1:8000`.
- Backend `backend/.env` (copy from `.env.example`): `STORE=supabase`, `AUTH_MODE=supabase`,
  `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (service-role / secret key: **backend only**).
  Leave `SUPABASE_JWT_SECRET` empty if the project uses the new signing keys (the backend
  then reads the public keys); fill it only for a project on the legacy JWT secret.

**5. Run.** Backend: `cd backend && set -a && source .env && set +a && uvicorn app.main:app`.
Frontend: `cd frontend && npm install && npm run build && npm start` (rebuild whenever you
change a `NEXT_PUBLIC_` value). Open http://localhost:3000.

**6. First admin.** Register normally (any type), click the link in the email, then in the
SQL Editor run:

```sql
update public.profiles set role = 'admin', approval_status = 'approved'
where email = 'you@example.com';
```

Sign in again: you land on the Admin Dashboard, where advisers are approved or rejected.
This SQL step is the only way to make an admin; the app can't.

**7. Try it.** Register one account of each type with different emails and check: supplier
→ MSME Dashboard; buyer → Buyer Dashboard; adviser → "Waiting for approval" until the admin
approves; typing another role's URL shows Access denied.

**8. Demo data (optional).** To give a supplier the seeded demo case:
`update businesses set owner_id = '<their auth user id>' where id = '11111111-1111-1111-1111-111111111111';`

### How roles are protected

| Layer | What it enforces |
|---|---|
| Database (`003_auth_roles.sql`) | A profile is created only by the trigger on `auth.users`. The sign-up form's role is a *request*: supplier and buyer are approved, adviser is `pending`, anything else (including `admin`) becomes supplier. Users have **no INSERT/DELETE** on `profiles` and may **UPDATE only** name, business name, mobile, address, Udyam, professional role and qualifications (column grants). A trigger also rejects any change to `role`, `approval_status`, `email` or `id` made with a user's own role, in case grants are widened by mistake. RLS: users read only their own profile; admins read all. `review_adviser()` checks `is_admin()` and logs every decision to `adviser_reviews`. Business data needs an approved supplier (`app_role() = 'supplier'`). |
| Backend (`app/auth.py`) | Verifies the Supabase JWT, reads the user's profile, then: business data needs an approved supplier; the calculator and rate table need any approved account; pending advisers and users without a profile get 403. |
| Frontend server (`middleware.ts`) | Every page: signed in? email verified? approved? right role? Otherwise redirects (login, verify email, pending approval, access denied). |
| Browser | Only hides links. Never trusted. |

Tests: `supabase/tests/test_rls.py` (30 checks on real Postgres, including attempts to
self-promote, edit other users, register as admin and write the review log directly),
`backend/tests/test_api.py` (role checks on every data endpoint) and `e2e/` (59 browser
checks). Run the RLS tests with any Postgres 15+:
`TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres python -m pytest supabase/tests -q`.

## API (frontend: start here)

Interactive docs at `/docs` once the server runs.

**Auth.** With `AUTH_MODE=supabase` every request must send the Supabase session token:
`Authorization: Bearer <access_token>`. The frontend's server-side proxy (`/proxy/api/*`)
adds it from the HttpOnly session cookie. The backend verifies it, reads the user's
`profiles` row for role and approval, and uses the business whose `owner_id` is that user;
`X-Business-Id` is ignored. Business endpoints need an approved `supplier`; `/calculate`
and `/rates` need any approved account. A new user calls `POST /api/businesses` first. With
`AUTH_MODE=demo` (memory store only) no token is needed and the demo business is used.
`STORE=supabase` refuses to start in demo auth mode.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | |
| GET / POST | `/api/businesses/me`, `/api/businesses` | Profile; Udyam format checked |
| POST | `/api/cases` | `{buyer: {name, gstin?, relationship_importance?}, contract_date?}`; creates 7 evidence rows |
| GET | `/api/cases` | List with live `totals`, `bucket`, `eligibility` (ageing board) |
| GET / PATCH | `/api/cases/{id}` | Full case: buyer, invoices with payments, evidence. PATCH: status, ladder_step, allocation, po_amount, dispute_reason (none/quality/quantity/other) |
| POST | `/api/cases/{id}/invoices` | Dates must not be in the future; objection after delivery |
| POST | `/api/invoices/{id}/payments` | Not before invoice date; not above everything owed that day (principal + interest, all earlier payments counted); identical date and amount needs `?confirm_duplicate=true` |
| PUT | `/api/cases/{id}/evidence/{kind}` | `{status: have/missing/unknown}` |
| POST | `/api/cases/{id}/evaluate` | `{as_of?}`; runs engine, stores snapshot, returns contract JSON |
| GET | `/api/cases/{id}/settlement` | Options from latest snapshot |
| POST | `/api/cases/{id}/promises/extract` | `{text, said_on?}` -> proposed `amount`, `due_date`, `missing`; saves nothing |
| POST / GET | `/api/cases/{id}/promises` | Save a promise the owner confirmed / list them |
| POST | `/api/cases/{id}/followups` | Owner logs a message they sent: `{step 1-3, sent_on, reply_received?}` |
| PATCH | `/api/followups/{id}` | `{reply_received}` |
| POST | `/api/cases/{id}/drafts` | `{kind: acceptance_confirm/nudge/firm/demand}` -> template draft from the latest evaluate; demand refused unless eligible |
| GET | `/api/invoices` | All invoices with payment status, days overdue, engine figures (`?as_of=`) |
| GET / PATCH / DELETE | `/api/invoices/{id}` | Detail; correct fields (re-validated, `clear: [...]` to empty dates); delete with its payments |
| DELETE | `/api/payments/{id}` | Remove a mistaken payment |
| POST | `/api/calculate` | What-if calculator: same engine, no saved case, eligibility not checked |
| GET | `/api/rates` | Verified Bank Rate rows with sources |
| POST | `/api/sim/message` | `{session, text}` -> `{replies: [...]}` |

Money is always a string (`"180000.00"`), dates ISO. Validation errors return 422 with
`{field, message, errors: [...]}`.

Per-invoice `status` in evaluate: `computed`, `disputed`, `missing_inputs`,
`rate_unavailable`, `not_eligible`, `eligibility_uncertain`. Only `computed` carries an
interest figure. Case `bucket`: `not_due`, `due_soon`, `overdue`,
`overdue_interest_accruing`.

## AI legal assistant (`backend/app/legal_ai.py`, `backend/app/legal_kb.py`)

Typed questions in the Legal Assistant go to Google Gemini (`POST /api/legal/ask`). Only the
question is sent, never case data. The model is told to answer only from the knowledge base
(`legal_kb.py`: MSMED Act ss.2(b), 2(n)/8, 15-18, 22-24, the income-tax rule s.43B(h) /
s.37(2)(g), the RBI Bank Rate table, filing route, 2026 amendment status) and to cite entry
ids. Before an answer is shown the backend checks that:

- every citation is a known entry, and there is at least one;
- every section number mentioned exists in the knowledge base;
- every number in the answer appears in the cited texts or the question (no invented rates,
  dates or amounts);
- it is valid JSON within length limits.

If any check fails, or there is no key, a network error or rate limit, the app shows the
team's prepared answer instead and labels it as such. Suggested questions always use the
prepared answers. Users can switch AI answers off, and can ask by voice and hear answers read aloud (browser speech, English, Hindi or Kannada). Limit: 8 questions a minute and 100 a day per user. Set `GEMINI_API_KEY`
(and optionally `GEMINI_MODEL`, default `gemini-3.8-flash`) in `backend/.env`; the key stays
on the server. Tests: `backend/tests/test_legal_ai.py` (a simulated Gemini, including
fabricated answers that must be rejected).

## Document check (`backend/app/doc_check.py`, `POST /api/documents/check`)

A supplier uploads a photo or PDF (JPG, PNG, WebP or PDF up to 8 MB; the real type is checked
from the file's bytes) from the floating Assistant or an invoice page. Two stages:

1. **Gemini reads** the document: its type and each field (invoice number, date, total, seller,
   buyer, GSTINs, PO number and date, delivery date, IRN, Udyam number), and for each value the
   exact text it was read from. The backend **drops any value that does not appear in its quoted
   text** and tells the user which were dropped, so invented values never reach the screen.
2. **Plain code compares** what was read with the records: document type (flags a wrong
   upload), invoice number, total (within ₹1), invoice date, buyer and seller names, GSTINs (and
   their check digits), PO date, Udyam number. Verdict: looks right, check this, wrong document,
   or unreadable.

Nothing is saved; the file is not stored. If the document looks right, the user can mark it as
"on file" for the case. Tests: `backend/tests/test_doc_check.py`.

## Recovery Copilot (`backend/copilot/`, no AI)

`POST /evaluate` now also returns:

- `findings`: rule-based checks, each with `severity` (blocking/warning/info), `message`,
  `fix` and `sources` (e.g. `invoice:INV-114.amount`, `evidence:delivery_proof`).
  Checks: invoices over the PO amount, invoice before PO, missing delivery date,
  unresolved objection, buyer dispute, Udyam after PO, no delivery proof, acceptance only
  by deeming, each document ODR needs.
- `readiness`: whether the five documents ODR needs are on file and nothing is blocking.
- `promises`: each confirmed promise marked `kept`, `kept_late`, `part_kept`, `broken` or
  `pending` against recorded payments.
- `next_action`: one recommendation with `reasons`, `based_on`, `alternatives`, optional
  `caution`, and the `rule` that fired. Rules, first match wins: nothing owed -> close;
  dispute -> resolve it; missing facts -> complete them; not overdue -> wait; promise still
  in time -> wait; PO mismatch -> fix it; no delivery proof and no follow-ups -> ask buyer to
  confirm receipt; otherwise the ladder (nudge, firm, formal demand, ODR pack) chosen from
  days overdue, customer importance, follow-ups sent and replies, and broken promises.
  Eligibility not clearly met caps it at a firm reminder with a caution; the ODR pack is
  replaced by "collect evidence" until the file is ready.

Promise extraction is rule-based (`copilot/promises.py`: 50k, Rs 1.5 lakh, 25,000;
tomorrow, Friday, 5/11, 15 Nov, in 3 days, month end). The owner always confirms before a
promise is saved.

## Demo case (seeded)

Sri Lakshmi Packaging (micro, Udyam since 12 May 2023) vs Kaveri Foods Pvt Ltd.
As of 25 Oct 2026, interest-first: INV-114 Rs 1,44,734.20, INV-131 Rs 1,01,338.41,
total **Rs 2,46,072.61** (Rs 2,46,066.63 principal-first). These numbers are asserted in
`tests/test_api.py`.

Demo story (also a test): next action starts as a friendly nudge. Paste "Sir, will pay 50k
by 23/10 sure" said on 20 Oct, confirm it, and evaluate as of 25 Oct: the promise is
broken and the next action becomes a firm reminder that cites it.

## Calculation assumptions (shown to users)

| ID | Assumption |
|---|---|
| A1 | "N days from day X" excludes day X (General Clauses Act s.9) |
| A2 | Agreed period over 45 days: interest from the day after the 45-day cap |
| A3 | Daily accrual at 3x the RBI Bank Rate in force that day, /365 |
| A4 | Monthly rests on the interest start's day-of-month |
| A5 | Interest stops on a paid amount from the payment date |
| A6 | Payment allocation is the user's choice (the Act is silent). Between rests, principal-first gives a slightly lower total, because interest accrued since the last rest is not yet interest-bearing |
| A7 | Rounding to paise at each rest |
| A8 | Unpaid interest keeps compounding after the principal is paid |

Bank Rate table (`recovery_engine/rates.py`) has verified rows from 5 Dec 2025 (5.50%)
and 7 Oct 2026 (5.75%). Earlier dates return `rate_unavailable` instead of guessing.

## Known limitations

- Estimates only; not legal advice. Verify before filing.
- Bank Rate history starts 5 Dec 2025.
- Staged services and partial acceptance are not modelled.
- GSTIN and Udyam numbers are format-checked only, not verified with government systems.
- Refunds and payment reversals are not modelled; delete a wrong payment row instead.
- Not yet run against a live Supabase project. The sign-in flows were tested end to end against a stand-in for Supabase Auth and PostgREST (`e2e/`), and the SQL against real Postgres 16. Run the setup steps above and step 7 once on the real project before relying on it.
- Supabase's built-in email service is for testing; real users need your own SMTP settings.
- Adviser case sharing and buyer invoice linking are not built; those dashboards say so.

## AI use disclosure

We used AI in two separate ways: as a development assistant while building the project, and
as a feature inside the product.

### 1. AI used to build the project

| Tool | What it was used for |
|---|---|
| Claude (Anthropic), through Claude Code | Writing most of the code with us: the FastAPI backend, the MSMED Act calculation engine (`recovery_engine`), the recovery copilot rules, the Next.js pages, Supabase migrations and row-level security, the sign-in flows, the Gemini integration, and the tests. Also used for legal research (checking sections, RBI Bank Rate dates, the ODR portal and the s.43B(h) → s.37(2)(g) change), the README, demo data and the Evaluation 1 briefing. |
| [Other tools the team used, e.g. ChatGPT, Copilot — or delete this row] | [What for] |

How we kept the AI-assisted work correct:
- **The legal rules were checked against the Act, not taken on trust.** Each rule in the engine
  cites its section, and the assumptions it makes (A1–A8) are listed in this README.
- **Tests from worked examples.** The demo case is checked to the paisa
  (₹2,46,072.61 as of 25 Oct 2026), alongside 227 backend tests, 30 database security tests,
  41 frontend tests and 59 end-to-end sign-in checks.
- **People reviewed it.** [Team member names] reviewed [which parts, e.g. the interest
  calculation, the legal text, the UI flows] and ran the app end to end.
- **What we built or changed ourselves:** [e.g. Settle45 branding, Supabase query batching,
  extra seed scenarios, testing with the live Supabase project — the team fills this in].

### 2. AI inside the product (Google Gemini)

- **Legal Q&A** (typed or spoken): Gemini answers only from our reviewed knowledge base of
  Act texts (`backend/app/legal_kb.py`). An answer is rejected, and the team's prepared answer
  shown instead, if it cites an unknown source, mentions a section outside the knowledge base,
  or contains any number not present in the cited text. Only the question is sent, never case
  data.
- **Document check**: Gemini reads an uploaded photo or PDF and must quote the exact text each
  value came from. Values that don't appear in their quote are dropped. The comparison with
  the user's records is done by plain code, not by the AI. Files are not stored.
- **What AI never does in Settle45:** calculate amounts, dates or interest; decide whether a
  supplier is eligible; or write the reminder and demand drafts. These all come from
  deterministic, tested code and fixed templates.
- AI answers are labelled "AI-assisted", and users can switch AI off. Without a key, the app
  falls back to the prepared answers.

All business names, people and figures in the demo data are fictional.
