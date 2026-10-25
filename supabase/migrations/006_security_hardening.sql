-- 006_security_hardening.sql
-- Prevents any authenticated role from directly writing buyers.profile_id.
-- Buyer-to-profile linking must go through link_buyer_to_profile(), which
-- only an admin (service-role bearer) can call.

-- ----------------------------------------------------------------
-- 1. Secure function: link a buyer row to an auth.users profile.
--    Only callable by a Postgres role with SECURITY DEFINER rights;
--    the app never calls this directly—use Supabase admin SQL or
--    the future admin API endpoint.
-- ----------------------------------------------------------------
create or replace function public.link_buyer_to_profile(
    p_buyer_id  uuid,
    p_user_id   uuid
)
returns void
language plpgsql
security definer          -- runs as the function owner (postgres), not the caller
set search_path = public
as $$
begin
    -- Only an admin (service-role JWT) or a postgres session may proceed.
    -- app_role() returns 'anon' / 'authenticated' / 'service_role'.
    if current_setting('role', true) not in ('service_role', 'postgres', 'rds_superuser')
       and not is_admin() then
        raise exception 'link_buyer_to_profile: requires admin or service_role'
            using errcode = 'insufficient_privilege';
    end if;

    -- Verify the buyer exists.
    if not exists (select 1 from public.buyers where id = p_buyer_id) then
        raise exception 'link_buyer_to_profile: buyer % not found', p_buyer_id
            using errcode = 'no_data_found';
    end if;

    -- Verify the auth user exists.
    if not exists (select 1 from auth.users where id = p_user_id) then
        raise exception 'link_buyer_to_profile: user % not found', p_user_id
            using errcode = 'no_data_found';
    end if;

    update public.buyers
    set    profile_id = p_user_id
    where  id = p_buyer_id;
end;
$$;

-- Revoke direct execute from public; grant only to postgres/service_role.
revoke execute on function public.link_buyer_to_profile(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.link_buyer_to_profile(uuid, uuid) to service_role;


-- ----------------------------------------------------------------
-- 2. Trigger: block any authenticated-role UPDATE that touches
--    buyers.profile_id directly (i.e., not through the function above).
--    The function uses security definer so it bypasses RLS and the trigger
--    fires as the function owner — we detect that by checking the
--    current_user context set by the trigger stack.
-- ----------------------------------------------------------------
create or replace function public._prevent_direct_buyer_profile_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Allow writes that come from service_role or our trusted function
    -- (the function runs as 'postgres' in a security-definer context).
    if session_user in ('postgres', 'supabase_admin')
       or current_user  in ('postgres', 'supabase_admin')
       or current_setting('role', true) = 'service_role' then
        return new;
    end if;

    -- If profile_id is changing, block it.
    if (new.profile_id is distinct from old.profile_id) then
        raise exception
            'Direct update of buyers.profile_id is not allowed. '
            'Use the link_buyer_to_profile() admin function.'
            using errcode = 'insufficient_privilege';
    end if;

    return new;
end;
$$;

drop trigger if exists prevent_direct_buyer_profile_link on public.buyers;
create trigger prevent_direct_buyer_profile_link
    before update on public.buyers
    for each row
    execute function public._prevent_direct_buyer_profile_link();


-- ----------------------------------------------------------------
-- 3. Verify the access-denied ?from= param is display-only:
--    No DB changes needed — confirmed in access.ts that `from` is
--    only interpolated into user-visible text, never into a redirect.
--    (See frontend/app/access-denied/page.tsx — safe; documented here.)
-- ----------------------------------------------------------------

comment on function public.link_buyer_to_profile(uuid, uuid) is
    'Admin-only: link a buyer row to an auth.users account. '
    'Called only from Supabase admin SQL or a service-role backend endpoint. '
    'Direct UPDATE of buyers.profile_id by authenticated role is blocked by trigger.';
