-- LS-03: buyer accounts linking and case sharing with approved advisers. Run after 004.
-- Every reference to the row being checked is written as <table>.<column>. Inside a
-- subquery an unqualified name binds to the subquery's own tables first, which made some
-- checks always true (advisers could read every case's invoices and evidence) or ambiguous.

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
          where c.id = case_shares.case_id and b.owner_id = auth.uid())
) with check (
  exists (select 1 from cases c join businesses b on b.id = c.business_id
          where c.id = case_shares.case_id and b.owner_id = auth.uid())
);

-- Approved adviser can read shares assigned to them
create policy adviser_view_shares on public.case_shares for select using (
  adviser_id = auth.uid() and public.app_role() = 'adviser'
);

-- 4 and 5. Read access for advisers (shared cases) and buyers (their own invoices).
-- The checks run inside SECURITY DEFINER helpers that read the tables directly. Writing them
-- as subqueries inside the policies made Postgres loop (businesses -> cases -> businesses)
-- and, with unqualified column names, made some checks always true.

create or replace function public.adviser_can_see_case(p_case uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select public.app_role() = 'adviser' and exists (
    select 1 from public.case_shares cs where cs.case_id = p_case and cs.adviser_id = auth.uid());
$$;

create or replace function public.adviser_can_see_invoice(p_invoice uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select public.app_role() = 'adviser' and exists (
    select 1 from public.invoices i join public.case_shares cs on cs.case_id = i.case_id
    where i.id = p_invoice and cs.adviser_id = auth.uid());
$$;

create or replace function public.adviser_can_see_buyer(p_buyer uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select public.app_role() = 'adviser' and exists (
    select 1 from public.cases c join public.case_shares cs on cs.case_id = c.id
    where c.buyer_id = p_buyer and cs.adviser_id = auth.uid());
$$;

create or replace function public.adviser_can_see_business(p_business uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select public.app_role() = 'adviser' and exists (
    select 1 from public.cases c join public.case_shares cs on cs.case_id = c.id
    where c.business_id = p_business and cs.adviser_id = auth.uid());
$$;

create or replace function public.buyer_can_see_case(p_case uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select public.app_role() = 'buyer' and exists (
    select 1 from public.cases c join public.buyers b on b.id = c.buyer_id
    where c.id = p_case and b.profile_id = auth.uid());
$$;

create or replace function public.buyer_can_see_invoice(p_invoice uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select public.app_role() = 'buyer' and exists (
    select 1 from public.invoices i join public.cases c on c.id = i.case_id
    join public.buyers b on b.id = c.buyer_id
    where i.id = p_invoice and b.profile_id = auth.uid());
$$;

create or replace function public.buyer_can_see_business(p_business uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select public.app_role() = 'buyer' and exists (
    select 1 from public.cases c join public.buyers b on b.id = c.buyer_id
    where c.business_id = p_business and b.profile_id = auth.uid());
$$;

revoke all on function public.adviser_can_see_case(uuid), public.adviser_can_see_invoice(uuid),
  public.adviser_can_see_buyer(uuid), public.adviser_can_see_business(uuid),
  public.buyer_can_see_case(uuid), public.buyer_can_see_invoice(uuid),
  public.buyer_can_see_business(uuid) from public, anon;
grant execute on function public.adviser_can_see_case(uuid), public.adviser_can_see_invoice(uuid),
  public.adviser_can_see_buyer(uuid), public.adviser_can_see_business(uuid),
  public.buyer_can_see_case(uuid), public.buyer_can_see_invoice(uuid),
  public.buyer_can_see_business(uuid) to authenticated;

create policy adviser_read_shared_cases on public.cases for select
  using (public.adviser_can_see_case(id));
create policy adviser_read_shared_invoices on public.invoices for select
  using (public.adviser_can_see_case(case_id));
create policy adviser_read_shared_payments on public.payments for select
  using (public.adviser_can_see_invoice(invoice_id));
create policy adviser_read_shared_evidence on public.evidence_items for select
  using (public.adviser_can_see_case(case_id));
create policy adviser_read_shared_buyers on public.buyers for select
  using (public.adviser_can_see_buyer(id));
create policy adviser_read_shared_businesses on public.businesses for select
  using (public.adviser_can_see_business(id));

create policy buyer_read_self on public.buyers for select
  using (public.app_role() = 'buyer' and profile_id = auth.uid());
create policy buyer_read_linked_cases on public.cases for select
  using (public.buyer_can_see_case(id));
create policy buyer_read_linked_invoices on public.invoices for select
  using (public.buyer_can_see_case(case_id));
create policy buyer_read_linked_payments on public.payments for select
  using (public.buyer_can_see_invoice(invoice_id));
create policy buyer_read_supplier_businesses on public.businesses for select
  using (public.buyer_can_see_business(id));
