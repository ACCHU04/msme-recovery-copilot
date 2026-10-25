-- Settle45 C1: reminders the owner has dismissed. Reminders themselves are worked out on the
-- fly from invoices, promises and follow-ups; only the "hide this one" choice is stored.
-- Run after 010. Written through the backend; signed-in suppliers can read their own.
create table if not exists public.reminder_dismissals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses on delete cascade,
  key text not null check (char_length(key) between 3 and 200),
  dismissed_at timestamptz not null default now(),
  unique (business_id, key)
);

alter table public.reminder_dismissals enable row level security;
revoke all on public.reminder_dismissals from anon, authenticated;
grant select on public.reminder_dismissals to authenticated;

create policy owner_reads_reminder_dismissals on public.reminder_dismissals for select using (
  exists (select 1 from public.businesses b
          where b.id = reminder_dismissals.business_id and b.owner_id = auth.uid()));
