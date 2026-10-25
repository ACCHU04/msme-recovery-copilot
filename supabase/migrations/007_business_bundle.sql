-- Settle45: load everything a business's dashboard needs in ONE database round trip.
-- The backend used to send 8 queries (in 3 rounds); over the internet each round trip costs
-- 50-300 ms, so this function makes dashboard, invoice and case lists several times faster.
-- The backend falls back to the separate queries if this function is missing. Run after 006.

create or replace function public.business_bundle(p_business_id uuid)
returns json
language sql
stable
set search_path = public
as $$
  with c as (select * from cases where business_id = p_business_id),
       i as (select * from invoices where case_id in (select id from c))
  select json_build_object(
    'business',  (select row_to_json(b) from businesses b where b.id = p_business_id),
    'cases',     coalesce((select json_agg(c) from c), '[]'::json),
    'buyers',    coalesce((select json_agg(x) from buyers x where x.business_id = p_business_id), '[]'::json),
    'invoices',  coalesce((select json_agg(i) from i), '[]'::json),
    'payments',  coalesce((select json_agg(p) from payments p where p.invoice_id in (select id from i)), '[]'::json),
    'evidence',  coalesce((select json_agg(e) from evidence_items e where e.case_id in (select id from c)), '[]'::json),
    'promises',  coalesce((select json_agg(p) from promises p where p.case_id in (select id from c)), '[]'::json),
    'followups', coalesce((select json_agg(f) from followups f where f.case_id in (select id from c)), '[]'::json)
  );
$$;

-- Only the backend (service role) may call it: it returns a whole business's data and does
-- no ownership check of its own; the backend has already checked the signed-in user owns it.
revoke all on function public.business_bundle(uuid) from public, anon, authenticated;
grant execute on function public.business_bundle(uuid) to service_role;
