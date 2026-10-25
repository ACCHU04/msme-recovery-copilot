-- Settle45: buyer accounts linked to buyer records, and cases shared with advisers. Run after 004.

-- A supplier's buyer record can be linked to a buyer account, so that buyer sees the invoices
-- raised to it (read-only, through the backend). Linking is done by an admin for now.
alter table buyers add column account_id uuid references profiles (id) on delete set null;
create index buyers_account on buyers (account_id);

-- A supplier shares one case, read-only, with an approved adviser.
create table case_shares (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases on delete cascade,
  adviser_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (case_id, adviser_id)
);
create index case_shares_adviser on case_shares (adviser_id);

alter table case_shares enable row level security;

-- Suppliers cannot read other people's profiles (003), so this check runs as the owner of the
-- function. It reveals only yes/no for one id.
create function is_approved_adviser(uid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = uid
                 and p.role = 'adviser' and p.approval_status = 'approved');
$$;
revoke all on function is_approved_adviser(uuid) from public;
grant execute on function is_approved_adviser(uuid) to authenticated;

-- The case owner manages its shares, and can only share with an approved adviser.
create policy owner_manages_shares on case_shares for all using (
  exists (select 1 from cases c join businesses b on b.id = c.business_id
          where c.id = case_id and b.owner_id = auth.uid()))
  with check (
  exists (select 1 from cases c join businesses b on b.id = c.business_id
          where c.id = case_id and b.owner_id = auth.uid())
  and is_approved_adviser(adviser_id));

-- An adviser sees the shares made to them.
create policy adviser_reads_own_shares on case_shares for select using (adviser_id = auth.uid());
