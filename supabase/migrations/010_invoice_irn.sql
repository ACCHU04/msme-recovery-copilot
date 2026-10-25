-- Settle45 B1: the IRN from an e-invoice's signed QR code, saved after it matched the invoice.
-- Run after 009.
alter table public.invoices
  add column if not exists irn text check (irn is null or irn ~ '^[0-9a-f]{64}$');
create unique index if not exists invoices_irn on public.invoices (irn) where irn is not null;
