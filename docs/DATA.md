# Settle45: database and file storage

Layers 6–7: how data is stored, kept consistent, backed up, and how uploaded files are handled.

## Tables and how they connect

```
auth.users ─1:1─ profiles (role, approval)
                    │
businesses (owner_id → profiles) ─┬─ buyers (account_id → buyer's profile, optional)
                                  └─ cases (buyer_id → buyers)
                                       ├─ invoices ─┬─ payments
                                       │            └─ invoice_notes
                                       ├─ milestones (invoice_id optional)
                                       ├─ evidence_items (one per kind)
                                       ├─ promises, followups, drafts, calculations
                                       └─ case_shares (adviser_id → adviser's profile)
adviser_reviews: admin decisions on adviser accounts (append-only log)
```

## Rules the database itself guarantees

- **Ownership (row-level security):** a supplier reads and writes only rows under a business it
  owns; advisers read only shares made to them; nobody can change their own role or approval
  (`003_auth_roles.sql`, `005_buyer_links_case_shares.sql`).
- **Valid values:** amounts are positive; status, size, activity, role and evidence kind are
  limited to known values; GSTIN, PAN, Udyam and mobile numbers must match their formats.
- **Uniqueness:** one evidence row per kind per case; one share per adviser per case; one
  invoice number per case (`006`).
- **Deletes:** removing a case removes its invoices, payments, notes and other child rows;
  removing an invoice unlinks its milestones instead of deleting them.

## Indexes (for the queries run most)

| Query | Index |
|---|---|
| Find the signed-in user's business (every request) | `businesses (owner_id)` |
| A business's buyers and cases | `buyers (business_id)`, `cases (business_id)` |
| A case's invoices, promises, follow-ups, milestones, drafts | `invoices (case_id)`, `promises (case_id)`, `followups (case_id)`, `milestones (case_id)`, `drafts (case_id)` |
| An invoice's payments and notes | `payments (invoice_id)`, `invoice_notes (invoice_id)` |
| Latest calculation of a case | `calculations (case_id, created_at desc)` |
| Buyer view, adviser view | `buyers (account_id)`, `case_shares (adviser_id)`, `cases (buyer_id)` |
| Share by adviser email | `profiles (lower(email))` |
| Pending advisers for the admin | partial index on `profiles (approval_status)` |

## Changing the database

Every change is a numbered migration in `supabase/migrations/`, run in order (001 → 007),
never a manual edit in the dashboard. `supabase/tests/test_rls.py` applies all of them plus
`seed.sql` to a fresh Postgres and runs 33 security and data tests.

## Backup and restore

Tested on 25 Oct 2026: the seeded database (3 businesses, 13 cases, 19 invoices, 10 payments)
was dumped and restored into an empty database, and every count matched.

```bash
# 1. Back up (connection string from Supabase: Project Settings → Database)
pg_dump "$DATABASE_URL" -Fc -f settle45-$(date +%F).dump

# 2. Restore into an empty database (a new Supabase project, or local Postgres for a check)
pg_restore --no-owner --clean --if-exists -d "$TARGET_DATABASE_URL" settle45-YYYY-MM-DD.dump

# 3. Check it worked
psql "$TARGET_DATABASE_URL" -c "select count(*) from cases; select count(*) from invoices;"
```

Plan: a dump before every migration and once a week, kept for 4 weeks outside Supabase.
Supabase's own scheduled backups depend on the plan; check the current plan's details.
Restore into a separate project first, never straight over live data.

## Files (uploads)

| Rule | How |
|---|---|
| Where files go | **Not stored.** The document check reads the upload in memory, sends it to Gemini, compares the result and discards the file. Nothing is written to disk or the database. |
| Size limit | 8 MB, checked on the server (`doc_check.MAX_BYTES`), returns 413 |
| File types | JPG, PNG, WebP, PDF, checked from the file's bytes, not its name (`sniff_mime`), returns 415 |
| Private by default | No upload is ever public; there are no file links to leak |

**Next step:** keep evidence files (PO, challan, invoice) for the case pack in **Supabase
Storage**, in a private bucket with one folder per business. Access would follow the same
ownership rule as the database, files would be served only through short-lived signed links,
and the same type and size limits would apply. The `evidence_items` table already has
`file_path` and `sha256` columns ready for it.
