-- Settle45 B2: evidence files kept with a case (PO, delivery proof, the buyer's reply...).
-- Run after 011. The files themselves live in a PRIVATE Storage bucket that only the backend
-- (service key) can read or write; this table records what was uploaded and its SHA-256,
-- so a later download can prove the file has not changed.
create table if not exists public.evidence_files (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases on delete cascade,
  invoice_id uuid references public.invoices on delete set null,
  kind text check (kind in ('po','invoice','delivery_proof','acceptance_reply','ledger','communications','udyam_cert')),
  file_name text not null check (char_length(file_name) between 1 and 120),
  content_type text not null check (content_type in ('application/pdf','image/png','image/jpeg','image/webp')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null unique,
  uploaded_at timestamptz not null default now(),
  unique (case_id, sha256)
);
create index if not exists evidence_files_case on public.evidence_files (case_id);

alter table public.evidence_files enable row level security;
revoke all on public.evidence_files from anon, authenticated;
grant select on public.evidence_files to authenticated;

create policy owner_reads_evidence_files on public.evidence_files for select using (
  exists (select 1 from public.cases c join public.businesses b on b.id = c.business_id
          where c.id = evidence_files.case_id and b.owner_id = auth.uid()));

-- The private bucket. No storage.objects policies are added, so signed-in users cannot reach
-- it directly; only the backend's service key can. Skipped on databases without Storage.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('evidence', 'evidence', false, 10485760,
            array['application/pdf','image/png','image/jpeg','image/webp'])
    on conflict (id) do update set public = false;
  end if;
end $$;
