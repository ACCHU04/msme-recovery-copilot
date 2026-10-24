-- Run after migrations 001 and 002.
-- Demo data (all names fictional). Expected result as of 2026-10-25, interest-first:
--   INV-114 total 144734.20, INV-131 total 101338.41, case total 246072.61
-- Fixed UUIDs so the frontend and tests can link to them.

insert into businesses (id, name, phone, udyam_no, size, activity, udyam_registered, udyam_reg_date)
values ('11111111-1111-1111-1111-111111111111', 'Sri Lakshmi Packaging', '+910000000001',
        'UDYAM-KR-00-0000000', 'micro', 'manufacturing', true, '2023-05-12');

insert into buyers (id, business_id, name, gstin, relationship_importance)
values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
        'Kaveri Foods Pvt Ltd', null, 'high');

insert into cases (id, business_id, buyer_id, contract_date, status, po_amount)
values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222', '2026-02-20', 'active', 275000.00);

insert into invoices (id, case_id, number, invoice_date, amount, delivery_date, agreed_due_date)
values
  ('44444444-4444-4444-4444-444444444441', '33333333-3333-3333-3333-333333333333',
   'INV-114', '2026-03-08', 180000.00, '2026-03-10', null),
  ('44444444-4444-4444-4444-444444444442', '33333333-3333-3333-3333-333333333333',
   'INV-131', '2026-05-02', 95000.00, '2026-05-04', '2026-06-03');

insert into payments (invoice_id, paid_on, amount)
values ('44444444-4444-4444-4444-444444444441', '2026-06-01', 50000.00);

insert into evidence_items (case_id, kind, status) values
  ('33333333-3333-3333-3333-333333333333', 'po', 'have'),
  ('33333333-3333-3333-3333-333333333333', 'invoice', 'have'),
  ('33333333-3333-3333-3333-333333333333', 'delivery_proof', 'have'),
  ('33333333-3333-3333-3333-333333333333', 'acceptance_reply', 'missing'),
  ('33333333-3333-3333-3333-333333333333', 'ledger', 'have'),
  ('33333333-3333-3333-3333-333333333333', 'communications', 'unknown'),
  ('33333333-3333-3333-3333-333333333333', 'udyam_cert', 'have');
