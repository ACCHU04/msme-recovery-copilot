-- Settle45: a written objection that covers only PART of an invoice. Run after 007.
-- The undisputed part is treated as accepted on delivery (interest runs as normal); the
-- disputed part has no due date until the objection is removed (MSMED Act s.2(b)).
alter table invoices
  add column if not exists disputed_amount numeric(14,2)
    check (disputed_amount is null or disputed_amount > 0);
alter table invoices
  add constraint invoices_disputed_within_amount
    check (disputed_amount is null or disputed_amount <= amount);
comment on column invoices.disputed_amount is
  'Part of the invoice the buyer objected to in writing; null = the whole invoice (if objected).';
