-- LS-03: business profile details, contract milestones, invoice notes. Run after 003.

-- Business profile details (display only; none of them affect MSMED eligibility).
alter table businesses
  add column description text check (char_length(description) <= 500),
  add column email text check (char_length(email) <= 254),
  add column address text check (char_length(address) <= 300),
  add column website text check (char_length(website) <= 200),
  add column gstin text check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  add column pan text check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  add column established_year int check (established_year between 1900 and 2100),
  add column products jsonb not null default '[]'::jsonb,      -- ["Corrugated boxes", ...]
  add column team jsonb not null default '[]'::jsonb,          -- [{name, role, email}]; listing gives no access
  add column documents jsonb not null default '{}'::jsonb;     -- {udyam_certificate: have|missing|unknown, ...}

-- Planned deliveries / payment stages of a purchase order (a case).
create table milestones (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  due_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  invoice_id uuid references invoices on delete set null,
  created_at timestamptz not null default now()
);
create index milestones_case on milestones (case_id);

create table invoice_notes (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index invoice_notes_invoice on invoice_notes (invoice_id);

alter table milestones enable row level security;
alter table invoice_notes enable row level security;

-- Same ownership rule as the other case tables. The businesses policy (003) already requires
-- an approved supplier, so these inherit that check through the join.
create policy own_milestones on milestones for all using (
  exists (select 1 from cases c join businesses b on b.id = c.business_id
          where c.id = case_id and b.owner_id = auth.uid()))
  with check (
  exists (select 1 from cases c join businesses b on b.id = c.business_id
          where c.id = case_id and b.owner_id = auth.uid()));

create policy own_invoice_notes on invoice_notes for all using (
  exists (select 1 from invoices i join cases c on c.id = i.case_id
          join businesses b on b.id = c.business_id
          where i.id = invoice_id and b.owner_id = auth.uid()))
  with check (
  exists (select 1 from invoices i join cases c on c.id = i.case_id
          join businesses b on b.id = c.business_id
          where i.id = invoice_id and b.owner_id = auth.uid()));
