-- Settle45: indexes for the queries run on every request, and one more data rule. Run after 005.

-- Every signed-in request looks up the user's business by owner (backend auth check).
create index if not exists businesses_owner on businesses (owner_id);
-- Joins from cases to buyers (buyer view, case lists).
create index if not exists cases_buyer on cases (buyer_id);
-- Drafts listed per case.
create index if not exists drafts_case on drafts (case_id);
-- Sharing a case looks up an adviser by email, case-insensitively.
create index if not exists profiles_email_lower on profiles (lower(email));

-- One invoice number per purchase order (the app already refuses duplicates; the database
-- now guarantees it even if two requests arrive at the same moment).
create unique index if not exists invoices_case_number on invoices (case_id, number);
