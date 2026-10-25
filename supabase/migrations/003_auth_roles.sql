-- LS-03: user profiles, roles and adviser approval.
-- Run after 001 and 002. Every statement is plain Postgres plus Supabase's auth schema.
--
-- How roles stay trustworthy
--   * A profile row is created ONLY by the trigger on auth.users below (security definer).
--     Signed-in users have no INSERT or DELETE privilege on profiles.
--   * The sign-up form sends a *requested* role. The trigger maps it:
--       supplier -> supplier, approved
--       buyer    -> buyer, approved
--       adviser  -> adviser, PENDING (no adviser access until an admin approves)
--       anything else, including 'admin' -> supplier, approved
--     Nobody can register as admin.
--   * Signed-in users may UPDATE only these columns of their own row:
--     full_name, business_name, mobile_number, business_address, udyam_number,
--     professional_role, qualifications (column-level GRANT). role, approval_status,
--     requested_role, email and id are not updatable by them at all, and a trigger
--     rejects any change to those columns made with the user's own database role.
--   * Approving or rejecting an adviser goes through review_adviser(), which checks
--     is_admin() and writes an audit row. Making someone an admin is done by the project
--     owner in the SQL editor (see README), never from the app.

-- ---------------------------------------------------------------- tables

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  full_name text not null check (char_length(full_name) between 2 and 100),
  business_name text check (char_length(business_name) <= 150),
  mobile_number text check (mobile_number ~ '^\+91[6-9][0-9]{9}$'),
  role text not null check (role in ('supplier', 'buyer', 'adviser', 'admin')),
  approval_status text not null check (approval_status in ('pending', 'approved', 'rejected')),
  requested_role text not null check (requested_role in ('supplier', 'buyer', 'adviser')),
  business_address text check (char_length(business_address) <= 300),
  udyam_number text check (udyam_number ~ '^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$'),
  professional_role text check (char_length(professional_role) <= 100),
  qualifications text check (char_length(qualifications) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth user. role and approval_status are set by trusted code only.';

create table public.adviser_reviews (
  id uuid primary key default gen_random_uuid(),
  adviser_id uuid not null references public.profiles on delete cascade,
  decided_by uuid not null references public.profiles,
  decision text not null check (decision in ('approved', 'rejected')),
  note text check (char_length(note) <= 500),
  decided_at timestamptz not null default now()
);

create index adviser_reviews_adviser on public.adviser_reviews (adviser_id);
create index profiles_pending on public.profiles (approval_status) where approval_status = 'pending';

-- ---------------------------------------------------------------- helpers

-- Role of the signed-in user, or null if they are not approved. Used by policies.
create or replace function public.app_role()
returns text language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.approval_status = 'approved'
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.app_role() = 'admin', false)
$$;

-- ---------------------------------------------------------------- sign-up trigger

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  req text := coalesce(meta ->> 'requested_role', 'supplier');
  mobile text := nullif(trim(meta ->> 'mobile_number'), '');
  udyam text := upper(nullif(trim(meta ->> 'udyam_number'), ''));
begin
  if req not in ('supplier', 'buyer', 'adviser') then
    req := 'supplier';   -- includes any attempt to request 'admin'
  end if;
  -- Optional fields that fail the format checks are dropped rather than blocking sign-up;
  -- the app validates them before sending, so this only affects hand-crafted requests.
  if mobile is not null and mobile !~ '^\+91[6-9][0-9]{9}$' then mobile := null; end if;
  if udyam is not null and udyam !~ '^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$' then udyam := null; end if;

  insert into public.profiles (id, email, full_name, business_name, mobile_number, role,
                               approval_status, requested_role, business_address, udyam_number,
                               professional_role, qualifications)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(left(trim(meta ->> 'full_name'), 100), ''), split_part(coalesce(new.email, 'user'), '@', 1)),
    nullif(left(trim(meta ->> 'business_name'), 150), ''),
    mobile,
    req,
    case when req = 'adviser' then 'pending' else 'approved' end,
    req,
    nullif(left(trim(meta ->> 'business_address'), 300), ''),
    udyam,
    nullif(left(trim(meta ->> 'professional_role'), 100), ''),
    nullif(left(trim(meta ->> 'qualifications'), 300), '')
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- guard trigger

-- Belt and braces on top of the column grants: if the statement runs as the signed-in
-- user's database role, privileged columns cannot change. Trusted paths (SQL editor as
-- postgres, the service role, and security-definer functions owned by postgres) run as
-- other roles and pass.
create or replace function public.guard_profile_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.id is distinct from old.id
    or new.email is distinct from old.email
    or new.role is distinct from old.role
    or new.approval_status is distinct from old.approval_status
    or new.requested_role is distinct from old.requested_role
    or new.created_at is distinct from old.created_at) then
    raise exception 'Only an administrator can change role or approval status'
      using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------------------------------------------------------------- admin actions

create or replace function public.review_adviser(target uuid, decision text, note text default null)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare
  result public.profiles;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can review advisers' using errcode = '42501';
  end if;
  if decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected' using errcode = '22023';
  end if;
  update public.profiles set approval_status = decision
   where id = target and role = 'adviser'
  returning * into result;
  if result.id is null then
    raise exception 'No adviser account with that id' using errcode = 'P0002';
  end if;
  insert into public.adviser_reviews (adviser_id, decided_by, decision, note)
  values (target, auth.uid(), decision, nullif(left(trim(note), 500), ''));
  return result;
end $$;

-- ---------------------------------------------------------------- privileges

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, business_name, mobile_number, business_address, udyam_number,
              professional_role, qualifications) on public.profiles to authenticated;

revoke all on public.adviser_reviews from anon, authenticated;
grant select on public.adviser_reviews to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.guard_profile_update() from public, anon, authenticated;
revoke all on function public.review_adviser(uuid, text, text) from public, anon;
grant execute on function public.review_adviser(uuid, text, text) to authenticated;
revoke all on function public.app_role() from public, anon;
grant execute on function public.app_role() to authenticated;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------- row level security

alter table public.profiles enable row level security;
alter table public.adviser_reviews enable row level security;

create policy profiles_read_own on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy adviser_reviews_read on public.adviser_reviews for select to authenticated
  using (adviser_id = auth.uid() or public.is_admin());
-- No insert/update/delete policies on adviser_reviews: only review_adviser() writes it.

-- Business data belongs to approved suppliers only. Replaces the policy from 001 so a
-- buyer or adviser account cannot create or read a business through the public API.
drop policy if exists own_business on public.businesses;
create policy own_business on public.businesses for all to authenticated
  using (owner_id = auth.uid() and public.app_role() = 'supplier')
  with check (owner_id = auth.uid() and public.app_role() = 'supplier');
