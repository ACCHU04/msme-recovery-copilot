# Settle45: business rules and API

Layers 4–5: the rules the server enforces (the browser never decides), and every API route.

## Business rules (all enforced on the server)

| Rule | Where | Tested in |
|---|---|---|
| Deemed acceptance on delivery unless a written objection within 15 days (s.2(b)) | `recovery_engine/due_date.py` | `tests/test_engine.py` |
| Pay within 15 days of acceptance with no written agreement; agreed period capped at 45 days (s.15) | `recovery_engine/due_date.py` | `test_engine.py`, `test_api.py` |
| Compound interest, monthly rests, 3 × RBI Bank Rate for each period (s.16); dates before the first verified rate refused | `recovery_engine/interest.py`, `rates.py` | `test_engine.py` |
| Only micro/small, Udyam-registered manufacturing or services suppliers get interest; registration after the order is "uncertain" | `recovery_engine/eligibility.py` | `test_api.py` |
| A payment cannot be dated before the invoice or exceed everything owed that day; a possible duplicate needs confirmation | `api/routes.py` `add_payment` | `test_api.py` |
| Invoice numbers are unique within a case (also a database rule, migration 006) | `api/routes.py`, migration 006 | `test_api.py`, `test_rls.py` |
| Drafts use only figures from the saved calculation; no formal demand when eligibility is not confirmed | `app/drafts.py` | `test_api.py` |
| Next step: dispute first, then missing facts, interest-only, not due, promises, ladder by buyer importance | `copilot/next_action.py` | `test_copilot.py` |
| Each request's business comes from the signed-in user, never from the browser (the demo header is ignored when sign-in is on) | `app/auth.py` | `test_api.py` |
| Roles: only approved suppliers own business data; buyers and advisers see linked or shared data read-only; pending advisers see nothing | `app/auth.py`, migrations 003 and 005 | `test_api.py`, `test_rls.py` |
| AI answers must cite known sources and contain no number missing from them; document values must appear in their quoted text | `app/legal_ai.py`, `app/doc_check.py` | `test_legal_ai.py`, `test_doc_check.py` |
| AI use is limited to 8 questions a minute and 100 a day per user | `app/legal_ai.py` | `test_legal_ai.py` |

## Errors

Every error has the same JSON shape: `{"detail": "message for the user"}`. Validation errors
also include `field` and an `errors` list. Unexpected errors return 500 with a generic message;
the details go only to the server log (`app/main.py`). Stack traces and database details are
never sent to the browser.

| Status | Meaning |
|---|---|
| 401 | Not signed in, or the session expired |
| 403 | Signed in, but this role or approval state may not do this |
| 404 | Not found, or not yours (the API does not reveal which) |
| 409 | Conflict: duplicate, or the case needs a calculation first |
| 413 / 415 | Upload too large (over 8 MB) or not a JPG, PNG, WebP or PDF |
| 422 | Input failed validation |
| 429 | Too many AI requests; try again later |
| 500 | Unexpected error; logged on the server |

Interactive docs for every route are served by FastAPI at `/docs` on the backend.

## Routes

Generated from the code (`backend/app/api/routes.py`). "Owner of the data" means the route also
checks that the case, invoice or payment belongs to the signed-in supplier's business.

| Method | Path | Who can call it | Purpose |
|---|---|---|---|
| GET | `/api/health` | Anyone | Is the API up; which store and engine version |
| GET | `/api/businesses/me` | Supplier (owner of the data) | The signed-in supplier's business profile |
| POST | `/api/businesses` | Supplier | Create or update the business profile (partial updates keep other fields) |
| POST | `/api/cases` | Supplier (owner of the data) | Create a contract/case with its buyer |
| GET | `/api/cases` | Supplier (owner of the data) | Case list for the ageing board: live totals and bucket per case |
| GET | `/api/cases/{case_id}` | Supplier (owner of the data) | One case with invoices, payments and evidence |
| PATCH | `/api/cases/{case_id}` | Supplier (owner of the data) | Change case facts (PO amount, dispute, allocation, status) |
| POST | `/api/cases/{case_id}/invoices` | Supplier (owner of the data) | Add an invoice (duplicate numbers refused) |
| POST | `/api/invoices/{invoice_id}/payments` | Supplier (owner of the data) | Rules: not before the invoice date; not more than everything owed on this invoice on that day (principal + statutory interest where computable), counting all earlier payments; an identical payment (same date and amount) needs confirm_duplicate=true |
| GET | `/api/invoices` | Supplier (owner of the data) | Every invoice across the business with payment status and engine figures |
| GET | `/api/invoices/{invoice_id}` | Supplier (owner of the data) | One invoice with payments, notes and milestones |
| PATCH | `/api/invoices/{invoice_id}` | Supplier (owner of the data) | Correct an invoice |
| DELETE | `/api/invoices/{invoice_id}` | Supplier (owner of the data) | Delete an invoice and its payments |
| DELETE | `/api/payments/{payment_id}` | Supplier (owner of the data) | Remove a payment entered by mistake |
| POST | `/api/calculate` | Any approved account | What-if calculator: same engine, no saved case, eligibility not checked |
| GET | `/api/rates` | Any approved account | Verified RBI Bank Rate rows used for s.16 interest, with sources |
| POST | `/api/legal/ask` | Any approved account | Grounded answer from Gemini, checked against the knowledge base |
| POST | `/api/documents/check` | Supplier (owner of the data) | Read an uploaded photo/PDF with Gemini, then compare it with the user's records in code |
| GET | `/api/legal/status` | Any approved account | Whether AI answers are on, and which model |
| PUT | `/api/cases/{case_id}/evidence/{kind}` | Supplier (owner of the data) | Mark an evidence item have / missing / not sure |
| POST | `/api/cases/{case_id}/evaluate` | Supplier (owner of the data) | Calculate the case and save a snapshot (used by drafts and settlement) |
| GET | `/api/cases/{case_id}/evaluation` | Supplier (owner of the data) | Read-only figures for pages that only display them |
| GET | `/api/cases/{case_id}/settlement` | Supplier (owner of the data) | Settlement options from the latest snapshot |
| POST | `/api/cases/{case_id}/promises/extract` | Supplier (owner of the data) | Reads a pasted buyer message and proposes amount and date |
| POST | `/api/cases/{case_id}/promises` | Supplier (owner of the data) | Save a confirmed buyer promise |
| GET | `/api/cases/{case_id}/promises` | Supplier (owner of the data) | List promises |
| POST | `/api/cases/{case_id}/followups` | Supplier (owner of the data) | The owner records that they sent a ladder message themselves (we never send) |
| PATCH | `/api/followups/{followup_id}` | Supplier (owner of the data) | Record whether the buyer replied |
| POST | `/api/cases/{case_id}/drafts` | Supplier (owner of the data) | Template draft from the latest calculation |
| GET | `/api/cases/{case_id}/milestones` | Supplier (owner of the data) | List delivery/payment milestones |
| POST | `/api/cases/{case_id}/milestones` | Supplier (owner of the data) | Add a milestone |
| PATCH | `/api/milestones/{milestone_id}` | Supplier (owner of the data) | Edit a milestone |
| DELETE | `/api/milestones/{milestone_id}` | Supplier (owner of the data) | Delete a milestone |
| GET | `/api/invoices/{invoice_id}/notes` | Supplier (owner of the data) | List invoice notes |
| POST | `/api/invoices/{invoice_id}/notes` | Supplier (owner of the data) | Add a note |
| DELETE | `/api/notes/{note_id}` | Supplier (owner of the data) | Delete a note |
| POST | `/api/sim/message` | Supplier | Simulated buyer chat for the demo |
| GET | `/api/buyer/invoices` | Buyer (role checked inside) | Invoices raised to the signed-in buyer, from every supplier that has linked the buyer record to this account |
| GET | `/api/cases/{case_id}/shares` | Supplier (owner of the data) | Advisers this case is shared with |
| POST | `/api/cases/{case_id}/shares` | Supplier (owner of the data) | Share the case with an approved adviser by email |
| DELETE | `/api/shares/{share_id}` | Supplier (owner of the data) | Stop sharing |
| GET | `/api/adviser/cases` | Approved adviser (role checked inside) | Cases suppliers have shared with the signed-in adviser (read-only summaries) |
