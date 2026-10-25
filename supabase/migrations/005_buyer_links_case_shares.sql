-- LS-03: buyer accounts linking and case sharing with approved advisers. Run after 004.

-- 1. Link buyers to their auth profiles
alter table public.buyers
  add column if not exists profile_id uuid references public.profiles(id) on delete set null;

create index if not exists buyers_profile on public.buyers (profile_id);

-- 2. Case shares table for approved advisers
create table if not exists public.case_shares (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  adviser_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (case_id, adviser_id)
);

create index if not exists case_shares_case on public.case_shares (case_id);
create index if not exists case_shares_adviser on public.case_shares (adviser_id);

alter table public.case_shares enable row level security;
grant select, insert, update, delete on public.case_shares to authenticated;

-- 3. RLS on case_shares
-- Supplier who owns the case can manage sharing
create policy own_case_shares on public.case_shares for all using (
  exists (select 1 from cases c join businesses b on b.id = c.business_id
          where c.id = case_id and b.owner_id = auth.uid())
) with check (
  exists (select 1 from cases c join businesses b on b.id = c.business_id
          where c.id = case_id and b.owner_id = auth.uid())
);

-- Approved adviser can read shares assigned to them
create policy adviser_view_shares on public.case_shares for select using (
  adviser_id = auth.uid() and public.app_role() = 'adviser'
);

-- 4. Read policies for approved advisers on shared case data
create policy adviser_read_shared_cases on public.cases for select using (
  public.app_role() = 'adviser' and exists (
    select 1 from public.case_shares cs
    where cs.case_id = id and cs.adviser_id = auth.uid()
  )
);

create policy adviser_read_shared_invoices on public.invoices for select using (
  public.app_role() = 'adviser' and exists (
    select 1 from public.case_shares cs
    where cs.case_id = case_id and cs.adviser_id = auth.uid()
  )
);

create policy adviser_read_shared_payments on public.payments for select using (
  public.app_role() = 'adviser' and exists (
    select 1 from public.invoices i
    join public.case_shares cs on cs.case_id = i.case_id
    where i.id = invoice_id and cs.adviser_id = auth.uid()
  )
);

create policy adviser_read_shared_evidence on public.evidence_items for select using (
  public.app_role() = 'adviser' and exists (
    select 1 from public.case_shares cs
    where cs.case_id = case_id and cs.adviser_id = auth.uid()
  )
);

create policy adviser_read_shared_buyers on public.buyers for select using (
  public.app_role() = 'adviser' and exists (
    select 1 from public.cases c
    join public.case_shares cs on cs.case_id = c.id
    where c.buyer_id = id and cs.adviser_id = auth.uid()
  )
);

create policy adviser_read_shared_businesses on public.businesses for select using (
  public.app_role() = 'adviser' and exists (
    select 1 from public.cases c
    join public.case_shares cs on cs.case_id = c.id
    where c.business_id = id and cs.adviser_id = auth.uid()
  )
);

-- 5. Read policies for buyers on their incoming invoices
create policy buyer_read_self on public.buyers for select using (
  public.app_role() = 'buyer' and profile_id = auth.uid()
);

create policy buyer_read_linked_cases on public.cases for select using (
  public.app_role() = 'buyer' and exists (
    select 1 from public.buyers b where b.id = buyer_id and b.profile_id = auth.uid()
  )
);

create policy buyer_read_linked_invoices on public.invoices for select using (
  public.app_role() = 'buyer' and exists (
    select 1 from public.cases c
    join public.buyers b on b.id = c.buyer_id
    where c.id = case_id and b.profile_id = auth.uid()
  )
);

create policy buyer_read_linked_payments on public.payments for select using (
  public.app_role() = 'buyer' and exists (
    select 1 from public.invoices i
    join public.cases c on c.id = i.case_id
    join public.buyers b on b.id = c.buyer_id
    where i.id = invoice_id and b.profile_id = auth.uid()
  )
);

create policy buyer_read_supplier_businesses on public.businesses for select using (
  public.app_role() = 'buyer' and exists (
    select 1 from public.cases c
    join public.buyers b on b.id = c.buyer_id
    where c.business_id = id and b.profile_id = auth.uid()
  )
);
