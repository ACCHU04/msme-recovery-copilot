-- Settle45 C4: one-time links for a buyer to confirm receipt of an invoice (no account needed).
-- Run after 008. Only a SHA-256 hash of each token is stored. Links are created and answered
-- through the backend (service role); signed-in suppliers can only read their own.
create table if not exists public.confirmation_links (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases on delete cascade,
  invoice_id uuid not null references public.invoices on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  response text check (response in ('received_ok', 'issue')),
  responder_name text check (char_length(responder_name) <= 100),
  note text check (char_length(note) <= 1000)
);
create index if not exists confirmation_links_invoice on public.confirmation_links (invoice_id);

alter table public.confirmation_links enable row level security;
revoke all on public.confirmation_links from anon, authenticated;
grant select on public.confirmation_links to authenticated;

create policy owner_reads_confirmation_links on public.confirmation_links for select using (
  exists (select 1 from public.cases c join public.businesses b on b.id = c.business_id
          where c.id = confirmation_links.case_id and b.owner_id = auth.uid()));
