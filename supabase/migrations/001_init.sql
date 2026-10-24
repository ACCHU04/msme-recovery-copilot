-- LS-03 MSME Payment Recovery Assistant: initial schema
-- Run in Supabase SQL editor (or `supabase db push`). Money is numeric(14,2), never float.

create extension if not exists pgcrypto;

create table businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users on delete cascade,
  phone text unique,
  name text not null,
  udyam_no text,
  size text check (size in ('micro','small','medium')),
  activity text check (activity in ('manufacturing','services','trader')),
  udyam_registered boolean,
  udyam_reg_date date,
  preferred_lang text not null default 'en' check (preferred_lang in ('en','kn')),
  created_at timestamptz not null default now()
);

create table buyers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses on delete cascade,
  name text not null,
  gstin text,
  is_cpse boolean not null default false,
  relationship_importance text check (relationship_importance in ('low','medium','high'))
);

create table cases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses on delete cascade,
  buyer_id uuid not null references buyers,
  contract_date date,
  status text not null default 'draft' check (status in ('draft','active','settled','archived')),
  ladder_step int not null default 0 check (ladder_step between 0 and 4),
  allocation text not null default 'interest_first'
    check (allocation in ('interest_first','principal_first')),
  created_at timestamptz not null default now()
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases on delete cascade,
  number text not null,
  invoice_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  delivery_date date,
  agreed_due_date date,
  objection_date date,
  objection_removed_date date
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices on delete cascade,
  paid_on date not null,
  amount numeric(14,2) not null check (amount > 0)
);

create table evidence_items (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases on delete cascade,
  kind text not null check (kind in ('po','invoice','delivery_proof','acceptance_reply',
                                     'ledger','communications','udyam_cert')),
  status text not null default 'unknown' check (status in ('have','missing','unknown')),
  file_path text,
  sha256 text,
  prev_hash text,
  added_at timestamptz not null default now(),
  unique (case_id, kind)
);

create table calculations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases on delete cascade,
  as_of date not null,
  engine_version text not null,
  inputs jsonb not null,
  outputs jsonb not null,
  created_at timestamptz not null default now()
);

create table drafts (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases on delete cascade,
  calculation_id uuid references calculations,
  kind text check (kind in ('nudge','firm','demand','acceptance_confirm')),
  lang text not null default 'en',
  body text not null,
  created_at timestamptz not null default now()
);

create table conversations (
  user_key text primary key,
  business_id uuid references businesses,
  case_id uuid references cases,
  state text not null default 'START',
  slots jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table inbound_messages (
  wa_message_id text primary key,
  user_key text not null,
  body text,
  received_at timestamptz not null default now()
);

create index on buyers (business_id);
create index on cases (business_id);
create index on invoices (case_id);
create index on payments (invoice_id);
create index on calculations (case_id, created_at desc);

-- Row-level security: a signed-in user sees only their own business's rows.
-- The backend uses the service-role key (bypasses RLS) for the WhatsApp webhook.
alter table businesses enable row level security;
alter table buyers enable row level security;
alter table cases enable row level security;
alter table invoices enable row level security;
alter table payments enable row level security;
alter table evidence_items enable row level security;
alter table calculations enable row level security;
alter table drafts enable row level security;
alter table conversations enable row level security;
alter table inbound_messages enable row level security;

create policy own_business on businesses for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy own_buyers on buyers for all using (
  exists (select 1 from businesses b where b.id = business_id and b.owner_id = auth.uid()));

create policy own_cases on cases for all using (
  exists (select 1 from businesses b where b.id = business_id and b.owner_id = auth.uid()));

create policy own_invoices on invoices for all using (
  exists (select 1 from cases c join businesses b on b.id = c.business_id
          where c.id = case_id and b.owner_id = auth.uid()));

create policy own_payments on payments for all using (
  exists (select 1 from invoices i join cases c on c.id = i.case_id
          join businesses b on b.id = c.business_id
          where i.id = invoice_id and b.owner_id = auth.uid()));

create policy own_evidence on evidence_items for all using (
  exists (select 1 from cases c join businesses b on b.id = c.business_id
          where c.id = case_id and b.owner_id = auth.uid()));

create policy own_calculations on calculations for all using (
  exists (select 1 from cases c join businesses b on b.id = c.business_id
          where c.id = case_id and b.owner_id = auth.uid()));

create policy own_drafts on drafts for all using (
  exists (select 1 from cases c join businesses b on b.id = c.business_id
          where c.id = case_id and b.owner_id = auth.uid()));
-- conversations and inbound_messages: no policies = only the service role can touch them.
