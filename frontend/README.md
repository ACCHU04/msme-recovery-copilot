# Frontend: MSME Payment Recovery (LS-03)

Next.js 15 (App Router) + TypeScript + Tailwind CSS 4 + Lucide icons. Talks to the FastAPI
backend in `../backend`. No legal calculation happens here: every amount, date, finding and
recommendation is displayed exactly as the API returns it.

## Run

```bash
# 1. backend (another terminal)
cd ../backend && uvicorn app.main:app --reload          # http://127.0.0.1:8000

# 2. frontend
cp .env.example .env.local
npm install
npm run dev                                             # http://localhost:3000
```

The app has two modes, chosen by `.env.local`:

| Mode | When | What happens |
|---|---|---|
| **Supabase sign-in** | `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` set | Real accounts, email verification, roles, password reset. Browser calls go to `/proxy/api/*`; the Next.js server adds the session token. Backend must run with `AUTH_MODE=supabase`. |
| **Demo** | both empty | The labelled offline demo: one fictional supplier, no passwords, backend `AUTH_MODE=demo`. Used for the recorded video if Supabase isn't ready. |

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project URL and anon (publishable) key. Public by design. |
| `NEXT_PUBLIC_SITE_URL` | Base for links in emails, e.g. `http://localhost:3000` |
| `BACKEND_URL` | Where the server-side proxy sends API calls (default `http://127.0.0.1:8000`) |
| `COOKIE_SECURE` | Optional override; cookies are `Secure` in production builds |
| `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_DEMO_BUSINESS_ID` | Demo mode only |

`NEXT_PUBLIC_*` values are compiled in: rebuild after changing them. Full Supabase setup
(project, migrations, email settings, first admin) is in the root `README.md`.

## Sign-in and roles: how it works

- **All Supabase Auth calls run on the server** (`app/auth/actions.ts`, server actions):
  sign in, register, resend verification, forgot / reset password, sign out, adviser review.
  The session lives in **HttpOnly, SameSite=Lax cookies** set by the server
  (`lib/auth/cookies.ts`). Page scripts can't read the tokens and nothing is stored in
  localStorage. "Keep me signed in" sets a 30-day cookie; otherwise the session ends when
  the browser closes.
- **`middleware.ts` runs before every page.** It refreshes the session, asks Supabase who
  the user is, reads their profile (role, approval) under row level security and applies
  the rules in `lib/auth/access.ts`: signed out → `/login?next=…`; email not verified →
  `/verify-email`; adviser not approved → `/pending-approval`; wrong role →
  `/access-denied`; `/` → the user's own dashboard. Typing another role's URL doesn't work.
- **Data calls** go to `app/proxy/[...path]/route.ts`, which forwards to the backend with
  `Authorization: Bearer <access token>` and blocks cross-site writes. The backend verifies
  the token and checks the role again; the database checks it a third time with RLS.
- **Email links** (verify, reset) land on `app/auth/callback/route.ts`, which exchanges the
  one-time code for a session and redirects by role.

| Role | Lands on | Can open |
|---|---|---|
| `supplier` | `/` MSME Dashboard | all supplier pages, Legal Assistant, Marketplace, Settings |
| `buyer` | `/buyer` Buyer Dashboard | Buyer Dashboard, Legal Assistant, Marketplace, Settings |
| `adviser` (approved) | `/adviser` Adviser Portal | Adviser Portal, Legal Assistant, Settings |
| `adviser` (pending / rejected) | `/pending-approval` | nothing else |
| `admin` | `/admin` Admin Dashboard | Admin Dashboard, Adviser Portal, Marketplace, Legal Assistant, Settings |

## Checks

```bash
npm run typecheck     # tsc --noEmit
npm run lint
npm test              # unit tests: formatting, API client, roles, validation, cookies (37)
LIVE_API=http://127.0.0.1:8000 npm test   # + live journey against a running backend (4)
npm run build
```

End-to-end sign-in tests (59 checks: register, verify, sign in, roles, typed URLs, proxy,
cookies, expiry, sign out, remember me, adviser approval, password reset, phone layout)
are in `../e2e/`. They run against a stand-in for Supabase Auth; see `../e2e/README.md`.

The live journey runs the demo story end to end through `lib/api.ts`: demo case loads with
consistent totals; a pasted promise is extracted, confirmed and broken; the next action moves
from nudge to firm reminder; the draft cites the missed promise; a new case with a PO
mismatch is created and flagged.

## Pages

| Route | What it shows | API used |
|---|---|---|
| `/login` | Email, password (show/hide), keep me signed in, forgot password, link to register; field errors, loading state, expired-session and signed-out notices. Demo mode: labelled demo entry | Supabase Auth (server action) |
| `/register` | Account type cards (MSME supplier, buyer / enterprise, adviser) with role-specific fields; full validation | Supabase Auth sign-up |
| `/registered`, `/verify-email` | Success screen with email-verification steps; resend link | Supabase Auth resend |
| `/forgot-password`, `/reset-password` | Request a reset link (same answer whether or not the email exists); choose a new password, other devices signed out | Supabase Auth |
| `/pending-approval`, `/access-denied` | Adviser waiting (or rejected); wrong-role page with a link to the user's own dashboard | none |
| `/buyer` | Buyer Dashboard: buyer duties under s.15, s.16, s.22, s.23; links to calculator and marketplace. Supplier invoices are not linked to buyers yet (says so) | none |
| `/admin` | Admin Dashboard: advisers waiting with Approve / Reject and a note; decisions log; account counts by role | Supabase (RLS) + `review_adviser()` |
| `/` | KPIs (invoiced, received, outstanding, overdue), invoice status by month, recent invoices, recovery cases with next step, upcoming due dates; Add invoice (asks which contract), quick actions Add invoice, Add contract, Calculate interest, Prepare evidence | `GET /invoices`, `GET /cases`, `POST /evaluate` |
| `/profile` | Business and registration details (Udyam, GSTIN, PAN), contact information, registration status, profile completeness, products and services, team members (listed for reference, no access), business document checklist, eligibility per case. Nothing is marked "verified" | `GET/POST /businesses` (saves only the fields sent), `GET /cases` |
| `/invoices` | All invoices with search, status filter and sort | `GET /invoices` |
| `/invoices/[id]` | Amount, received, unpaid, days overdue; payment timeline in date order; payment history (record, remove); verification checks (Passed / Needs review / Not checked / Disputed); buyer; notes; correct or delete invoice | `GET/PATCH/DELETE /invoices/{id}`, `POST /payments`, `DELETE /payments/{id}` |
| `/cases`, `/cases/new`, `/cases/[id]` | Recovery cases; 5-step add form; case page with 7-stage recovery journey, next step, drafts (Copy, Open in WhatsApp, I sent this), case check, invoices, promises, settlement, evidence | cases, evaluate, drafts, promises, followups, settlement |
| `/assistant` | Recovery journey, next step and draft for a chosen case | evaluate, drafts, followups |
| `/legal` | Q&A on the MSMED Act: typed questions get an AI-assisted answer (Gemini, grounded and checked, with source chips) when the backend has a key, else prepared answers; suggested questions use prepared answers; legal guidance; interest calculator; evidence checklist; next steps | `POST /calculate`, `GET /rates`, evaluate |
| `/buyers` | Buyer profile and payment performance from your own records: on-time rate, average delay, unpaid, promises kept or broken, monthly chart, full invoice history; "correct a record" link (the figures come from your own entries) | `GET /invoices`, `GET /cases`, evaluate |
| `/contracts` | Contracts and purchase orders: each case's PO with value, invoiced, paid, outstanding, status; search and filter; add contract | `GET /cases`, `GET /invoices` |
| `/contracts/[id]` | Contract details: overview, payment terms ("varies by invoice" when they differ; 45-day cap shown), delivery and payment milestones (add, remove, linked to invoices), linked invoices, documents checklist, activity; edit PO date/value; add invoice (`?add=invoice` opens it) | case, milestones, `PATCH /cases/{id}`, `POST /invoices` |
| `/marketplace` | **Preview only.** Fictional, labelled sample buyers; each listing's payment terms checked against the 45-day limit; saved locally; "Express interest" does nothing beyond a notice | none |
| `/adviser` | With Supabase: the approved adviser's portal; case sharing isn't built, so it says no cases are shared yet. Demo mode: **role preview** over the demo supplier's cases (priority, progress, notes kept in this browser) | demo: `GET /cases`, `GET /invoices`, evaluate |
| `/reports`, `/cases/[id]/report` | Reports list with KPIs and an as-of date; printable case report (save as PDF from the browser) | case, evaluate |
| `/settings` | Account, role and approval, sign out, backend connection status | `GET /health` |

## Honest gaps (shown in the UI, not hidden)

- **Sign-in:** real Supabase Auth is built and tested end to end against a stand-in auth server, and the database rules against real Postgres. It has **not yet been run against a real Supabase project**; do that once with the steps in the root README.
- **Case sharing with advisers** and **linking supplier invoices to buyer accounts** are not built; the adviser and buyer dashboards say so.
- **Changing your own profile details** (name, mobile) after sign-up has no screen yet; the database already allows it for those fields only.
- **Floating Assistant** (`components/assistant/`): a button in the bottom-right of every signed-in page opens a panel with *Ask* (the same chat as the Legal Assistant) and, for suppliers, *Check a document* (upload a photo or PDF; see the root README). Invoice pages have a "Check a document with AI" shortcut. Full-screen on phones; Escape closes it.
- **Voice (Legal Assistant):** ask by mic and hear answers in English, Hindi or Kannada using the browser's own speech features (`lib/voice.ts`). Voice input works in Chrome and Edge, not Firefox; Chrome sends the audio to Google to transcribe it. Spoken voices for Hindi and Kannada depend on the device. An "AI answers" switch turns Gemini off (prepared answers only); choices are remembered in the browser.
- **Legal Q&A:** AI-assisted when `GEMINI_API_KEY` is set on the backend (only the question is sent to Google; answers are checked against the Act texts); otherwise prepared answers matched by keywords.
- **Not built:** document upload (the documents tab is a checklist), a real marketplace (the page is labelled sample data), a real adviser service (the portal is a role preview of your own cases).
- **Contracts:** a contract is a recovery case's purchase order; PO references are generated from the order date and case ID.
- **Drafts:** fixed templates with figures from the calculation; no AI wording, English only.
- **Report:** HTML print view, saved as PDF by the browser, not a server-generated PDF.

## Structure

```
middleware.ts         page access by role (runs on the server before every page)
app/                  routes (client components, except /admin which reads Supabase on the server)
app/auth/             server actions for every Supabase Auth call; email-link callback
app/proxy/            server-side proxy to the backend that adds the session token
components/layout/    AppShell: header, sidebar, mobile menu, skip link
components/ui/        Card, Button, Badge, Field, states, EstimateNote
components/dashboard/ KPI cards, status donut, cases table, next steps, activity
components/cases/     next-step card, draft editor, findings, evidence, invoices, promises,
                      follow-ups, settlement, case facts
lib/api.ts            typed client: base URL (or /proxy), timeout, readable errors, 401 → sign in
lib/auth/             access rules, validation, cookie hardening, server Supabase client
components/auth/      sign-in page layout, password field with show/hide, form alerts
lib/format.ts         INR and date formatting, labels, source descriptions
types/api.ts          types matching the backend responses
tests/                Vitest unit tests + optional live journey
```

## Accessibility

Skip link; landmarks; one `h1` per page; every input labelled; icon buttons have names;
status shown by word and icon, not colour alone; tables have captions and header scopes;
chart has a text summary and legend; Escape closes the mobile menu and notifications;
checked for horizontal overflow at 390 px and 1280 px.
