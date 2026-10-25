-- Recovery Copilot: PO amount, dispute reason, payment promises, follow-up log.

alter table cases
  add column po_amount numeric(14,2) check (po_amount is null or po_amount > 0),
  add column dispute_reason text not null default 'none'
    check (dispute_reason in ('none','quality','quantity','other'));

create table promises (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases on delete cascade,
  made_on date not null,                -- when the buyer said it
  due_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  source_text text,                     -- the buyer's words, as pasted
  created_at timestamptz not null default now(),
  check (due_date >= made_on)
);

create table followups (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases on delete cascade,
  step int not null check (step between 1 and 3),   -- 1 nudge, 2 firm, 3 formal demand
  sent_on date not null,
  reply_received boolean not null default false,
  note text,
  created_at timestamptz not null default now()
);

create index on promises (case_id);
create index on followups (case_id);

alter table promises enable row level security;
alter table followups enable row level security;

create policy own_promises on promises for all using (
  exists (select 1 from cases c join businesses b on b.id = c.business_id
          where c.id = case_id and b.owner_id = auth.uid()));

create policy own_followups on followups for all using (
  exists (select 1 from cases c join businesses b on b.id = c.business_id
          where c.id = case_id and b.owner_id = auth.uid()));
