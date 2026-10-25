-- Run after migrations 001 to 006.
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

-- Profile details and milestones (migration 004). Fictional values; PAN and GSTIN are
-- format-valid samples, not real registrations.
update businesses set
  description = 'Corrugated boxes and printed cartons for food and FMCG brands.',
  email = 'accounts@srilakshmi.example',
  address = 'Plot 14, Peenya Industrial Area, Bengaluru 560058',
  gstin = '29ABCDE1234F1ZW', pan = 'ABCDE1234F', established_year = 2016,
  products = '["Corrugated boxes", "Printed cartons", "Food-grade liners"]',
  team = '[{"name": "Rajesh Sharma", "role": "Owner", "email": "rajesh@srilakshmi.example"},
           {"name": "Priya Nair", "role": "Accounts", "email": "priya@srilakshmi.example"}]',
  documents = '{"udyam_certificate": "have", "gst_certificate": "have", "pan_card": "have",
                "address_proof": "missing", "bank_details": "unknown"}'
where id = '11111111-1111-1111-1111-111111111111';

insert into milestones (id, case_id, title, due_date, amount, invoice_id) values
  ('55555555-5555-5555-5555-555555555551', '33333333-3333-3333-3333-333333333333',
   'First delivery: 3,000 cartons', '2026-03-10', 180000.00, '44444444-4444-4444-4444-444444444441'),
  ('55555555-5555-5555-5555-555555555552', '33333333-3333-3333-3333-333333333333',
   'Second delivery: 1,500 cartons', '2026-05-04', 95000.00, '44444444-4444-4444-4444-444444444442');

-- -----------------------------------------------------------------------------
-- EXTENSION: Unified supplier portfolio under Sri Lakshmi Packaging
-- ('11111111-1111-1111-1111-111111111111').
-- Every extension row carries its own fixed primary key and uses ON CONFLICT
-- so re-running the extension block is safe and idempotent.
-- Reference date for countdowns and calculations: 2026-10-25.
-- -----------------------------------------------------------------------------

-- Scenario 1: Paid on time (Orion Appliance Systems Pvt Ltd).
-- UI/Copilot demo: a fully settled invoice produces no outstanding balance and
-- recommends closing the case (R0-nothing-owed) rather than sending a reminder.
insert into buyers (id, business_id, name, gstin, is_cpse, relationship_importance)
values ('71000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
        'Orion Appliance Systems Pvt Ltd', '29AAACO1942H1ZH', false, 'medium')
on conflict (id) do update set
  business_id = excluded.business_id, name = excluded.name, gstin = excluded.gstin,
  is_cpse = excluded.is_cpse, relationship_importance = excluded.relationship_importance;

insert into cases (id, business_id, buyer_id, contract_date, status, ladder_step, allocation, po_amount, dispute_reason)
values ('71000000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111',
        '71000000-0000-4000-8000-000000000002', '2026-08-01', 'settled', 0, 'interest_first', 125000.00, 'none')
on conflict (id) do update set
  business_id = excluded.business_id, buyer_id = excluded.buyer_id, contract_date = excluded.contract_date,
  status = excluded.status, ladder_step = excluded.ladder_step, allocation = excluded.allocation,
  po_amount = excluded.po_amount, dispute_reason = excluded.dispute_reason;

insert into invoices (id, case_id, number, invoice_date, amount, delivery_date, agreed_due_date,
                      objection_date, objection_removed_date)
values ('71000000-0000-4000-8000-000000000004', '71000000-0000-4000-8000-000000000003',
        'SPC-2608-041', '2026-08-05', 125000.00, '2026-08-06', '2026-09-05', null, null)
on conflict (id) do update set
  case_id = excluded.case_id, number = excluded.number, invoice_date = excluded.invoice_date,
  amount = excluded.amount, delivery_date = excluded.delivery_date, agreed_due_date = excluded.agreed_due_date,
  objection_date = excluded.objection_date, objection_removed_date = excluded.objection_removed_date;

insert into payments (id, invoice_id, paid_on, amount)
values ('71000000-0000-4000-8000-000000000005', '71000000-0000-4000-8000-000000000004',
        '2026-08-31', 125000.00)
on conflict (id) do update set
  invoice_id = excluded.invoice_id, paid_on = excluded.paid_on, amount = excluded.amount;

insert into evidence_items (id, case_id, kind, status) values
  ('71000000-0000-4000-8000-000000000011', '71000000-0000-4000-8000-000000000003', 'po', 'have'),
  ('71000000-0000-4000-8000-000000000012', '71000000-0000-4000-8000-000000000003', 'invoice', 'have'),
  ('71000000-0000-4000-8000-000000000013', '71000000-0000-4000-8000-000000000003', 'delivery_proof', 'have'),
  ('71000000-0000-4000-8000-000000000014', '71000000-0000-4000-8000-000000000003', 'acceptance_reply', 'have'),
  ('71000000-0000-4000-8000-000000000015', '71000000-0000-4000-8000-000000000003', 'ledger', 'have'),
  ('71000000-0000-4000-8000-000000000016', '71000000-0000-4000-8000-000000000003', 'communications', 'have'),
  ('71000000-0000-4000-8000-000000000017', '71000000-0000-4000-8000-000000000003', 'udyam_cert', 'have')
on conflict (case_id, kind) do update set
  status = excluded.status;

-- Scenario 2: Overdue with missing delivery proof and ledger (Harvest Basket Retail LLP).
-- UI/Copilot demo: missing delivery proof and no prior follow-up triggers R6-confirm-receipt
-- ("Ask the buyer to confirm receipt") and leaves ODR readiness incomplete (3 of 5 documents).
insert into buyers (id, business_id, name, gstin, is_cpse, relationship_importance)
values ('72000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
        'Harvest Basket Retail LLP', '27AAEFH4910C1ZU', false, 'low')
on conflict (id) do update set
  business_id = excluded.business_id, name = excluded.name, gstin = excluded.gstin,
  is_cpse = excluded.is_cpse, relationship_importance = excluded.relationship_importance;

insert into cases (id, business_id, buyer_id, contract_date, status, ladder_step, allocation, po_amount, dispute_reason)
values ('72000000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111',
        '72000000-0000-4000-8000-000000000002', '2026-05-01', 'active', 0, 'interest_first', 68000.00, 'none')
on conflict (id) do update set
  business_id = excluded.business_id, buyer_id = excluded.buyer_id, contract_date = excluded.contract_date,
  status = excluded.status, ladder_step = excluded.ladder_step, allocation = excluded.allocation,
  po_amount = excluded.po_amount, dispute_reason = excluded.dispute_reason;

insert into invoices (id, case_id, number, invoice_date, amount, delivery_date, agreed_due_date,
                      objection_date, objection_removed_date)
values ('72000000-0000-4000-8000-000000000004', '72000000-0000-4000-8000-000000000003',
        'NCC-2605-118', '2026-05-05', 68000.00, '2026-05-06', null, null, null)
on conflict (id) do update set
  case_id = excluded.case_id, number = excluded.number, invoice_date = excluded.invoice_date,
  amount = excluded.amount, delivery_date = excluded.delivery_date, agreed_due_date = excluded.agreed_due_date,
  objection_date = excluded.objection_date, objection_removed_date = excluded.objection_removed_date;

insert into evidence_items (id, case_id, kind, status) values
  ('72000000-0000-4000-8000-000000000011', '72000000-0000-4000-8000-000000000003', 'po', 'have'),
  ('72000000-0000-4000-8000-000000000012', '72000000-0000-4000-8000-000000000003', 'invoice', 'have'),
  ('72000000-0000-4000-8000-000000000013', '72000000-0000-4000-8000-000000000003', 'delivery_proof', 'missing'),
  ('72000000-0000-4000-8000-000000000014', '72000000-0000-4000-8000-000000000003', 'acceptance_reply', 'missing'),
  ('72000000-0000-4000-8000-000000000015', '72000000-0000-4000-8000-000000000003', 'ledger', 'unknown'),
  ('72000000-0000-4000-8000-000000000016', '72000000-0000-4000-8000-000000000003', 'communications', 'unknown'),
  ('72000000-0000-4000-8000-000000000017', '72000000-0000-4000-8000-000000000003', 'udyam_cert', 'have')
on conflict (case_id, kind) do update set
  status = excluded.status;

-- Scenario 3: Part-kept and broken promises with escalation (Saffron Process Equipments Ltd).
-- UI/Copilot demo: buyer promised Rs 1,00,000.00 by 30 May 2026, paid only Rs 40,000.00 on
-- 05 Jun 2026 (part_kept), then promised the remaining Rs 60,000.00 by 30 Jun 2026 and paid
-- nothing further (broken). Follow-ups and promises agree chronologically and justify Step 3
-- (Send a formal demand, R8-ladder-3).
insert into buyers (id, business_id, name, gstin, is_cpse, relationship_importance)
values ('73000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
        'Saffron Process Equipments Ltd', '24AABCS7812R1ZW', false, 'medium')
on conflict (id) do update set
  business_id = excluded.business_id, name = excluded.name, gstin = excluded.gstin,
  is_cpse = excluded.is_cpse, relationship_importance = excluded.relationship_importance;

insert into cases (id, business_id, buyer_id, contract_date, status, ladder_step, allocation, po_amount, dispute_reason)
values ('73000000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111',
        '73000000-0000-4000-8000-000000000002', '2026-04-10', 'active', 2, 'interest_first', 200000.00, 'none')
on conflict (id) do update set
  business_id = excluded.business_id, buyer_id = excluded.buyer_id, contract_date = excluded.contract_date,
  status = excluded.status, ladder_step = excluded.ladder_step, allocation = excluded.allocation,
  po_amount = excluded.po_amount, dispute_reason = excluded.dispute_reason;

insert into invoices (id, case_id, number, invoice_date, amount, delivery_date, agreed_due_date,
                      objection_date, objection_removed_date)
values ('73000000-0000-4000-8000-000000000004', '73000000-0000-4000-8000-000000000003',
        'VTW-2604-077', '2026-04-11', 200000.00, '2026-04-12', null, null, null)
on conflict (id) do update set
  case_id = excluded.case_id, number = excluded.number, invoice_date = excluded.invoice_date,
  amount = excluded.amount, delivery_date = excluded.delivery_date, agreed_due_date = excluded.agreed_due_date,
  objection_date = excluded.objection_date, objection_removed_date = excluded.objection_removed_date;

insert into payments (id, invoice_id, paid_on, amount)
values ('73000000-0000-4000-8000-000000000005', '73000000-0000-4000-8000-000000000004',
        '2026-06-05', 40000.00)
on conflict (id) do update set
  invoice_id = excluded.invoice_id, paid_on = excluded.paid_on, amount = excluded.amount;

insert into promises (id, case_id, made_on, due_date, amount, source_text) values
  ('73000000-0000-4000-8000-000000000006', '73000000-0000-4000-8000-000000000003',
   '2026-05-20', '2026-05-30', 100000.00, 'We will clear Rs 1 lakh by 30 May.'),
  ('73000000-0000-4000-8000-000000000009', '73000000-0000-4000-8000-000000000003',
   '2026-06-10', '2026-06-30', 60000.00, 'Will transfer the remaining Rs 60,000 by 30 June.')
on conflict (id) do update set
  case_id = excluded.case_id, made_on = excluded.made_on, due_date = excluded.due_date,
  amount = excluded.amount, source_text = excluded.source_text;

insert into followups (id, case_id, step, sent_on, reply_received, note) values
  ('73000000-0000-4000-8000-000000000007', '73000000-0000-4000-8000-000000000003',
   1, '2026-05-20', true, 'Buyer confirmed the Rs 1 lakh payment commitment by 30 May.'),
  ('73000000-0000-4000-8000-000000000008', '73000000-0000-4000-8000-000000000003',
   2, '2026-06-07', true, 'Firm reminder after only Rs 40,000 was received on 5 Jun; buyer promised the remaining Rs 60,000 by 30 Jun.'),
  ('73000000-0000-4000-8000-000000000010', '73000000-0000-4000-8000-000000000003',
   2, '2026-07-05', false, 'Second firm reminder after the 30 Jun balance commitment was missed; no reply.')
on conflict (id) do update set
  case_id = excluded.case_id, step = excluded.step, sent_on = excluded.sent_on,
  reply_received = excluded.reply_received, note = excluded.note;

insert into evidence_items (id, case_id, kind, status) values
  ('73000000-0000-4000-8000-000000000011', '73000000-0000-4000-8000-000000000003', 'po', 'have'),
  ('73000000-0000-4000-8000-000000000012', '73000000-0000-4000-8000-000000000003', 'invoice', 'have'),
  ('73000000-0000-4000-8000-000000000013', '73000000-0000-4000-8000-000000000003', 'delivery_proof', 'have'),
  ('73000000-0000-4000-8000-000000000014', '73000000-0000-4000-8000-000000000003', 'acceptance_reply', 'have'),
  ('73000000-0000-4000-8000-000000000015', '73000000-0000-4000-8000-000000000003', 'ledger', 'have'),
  ('73000000-0000-4000-8000-000000000016', '73000000-0000-4000-8000-000000000003', 'communications', 'have'),
  ('73000000-0000-4000-8000-000000000017', '73000000-0000-4000-8000-000000000003', 'udyam_cert', 'have')
on conflict (case_id, kind) do update set
  status = excluded.status;

-- Scenario 4: Disputed invoice (Nila Fashion House Pvt Ltd).
-- UI/Copilot demo: a quality objection was raised within 15 days of delivery. The
-- follow-up note records the buyer's stated colour-variance concern; the next action
-- is to resolve the dispute before asking for payment (R1-dispute).
insert into buyers (id, business_id, name, gstin, is_cpse, relationship_importance)
values ('74000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
        'Nila Fashion House Pvt Ltd', '33AAACN8374M1Z2', false, 'high')
on conflict (id) do update set
  business_id = excluded.business_id, name = excluded.name, gstin = excluded.gstin,
  is_cpse = excluded.is_cpse, relationship_importance = excluded.relationship_importance;

insert into cases (id, business_id, buyer_id, contract_date, status, ladder_step, allocation, po_amount, dispute_reason)
values ('74000000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111',
        '74000000-0000-4000-8000-000000000002', '2026-06-24', 'active', 1, 'interest_first', 92500.00, 'quality')
on conflict (id) do update set
  business_id = excluded.business_id, buyer_id = excluded.buyer_id, contract_date = excluded.contract_date,
  status = excluded.status, ladder_step = excluded.ladder_step, allocation = excluded.allocation,
  po_amount = excluded.po_amount, dispute_reason = excluded.dispute_reason;

insert into invoices (id, case_id, number, invoice_date, amount, delivery_date, agreed_due_date,
                      objection_date, objection_removed_date)
values ('74000000-0000-4000-8000-000000000004', '74000000-0000-4000-8000-000000000003',
        'MTP-2607-212', '2026-07-01', 92500.00, '2026-07-02', null, '2026-07-10', null)
on conflict (id) do update set
  case_id = excluded.case_id, number = excluded.number, invoice_date = excluded.invoice_date,
  amount = excluded.amount, delivery_date = excluded.delivery_date, agreed_due_date = excluded.agreed_due_date,
  objection_date = excluded.objection_date, objection_removed_date = excluded.objection_removed_date;

insert into followups (id, case_id, step, sent_on, reply_received, note)
values ('74000000-0000-4000-8000-000000000006', '74000000-0000-4000-8000-000000000003',
        1, '2026-07-12', true, 'Buyer cited colour variance in the 10 Jul email; sample review requested.')
on conflict (id) do update set
  case_id = excluded.case_id, step = excluded.step, sent_on = excluded.sent_on,
  reply_received = excluded.reply_received, note = excluded.note;

insert into evidence_items (id, case_id, kind, status) values
  ('74000000-0000-4000-8000-000000000011', '74000000-0000-4000-8000-000000000003', 'po', 'have'),
  ('74000000-0000-4000-8000-000000000012', '74000000-0000-4000-8000-000000000003', 'invoice', 'have'),
  ('74000000-0000-4000-8000-000000000013', '74000000-0000-4000-8000-000000000003', 'delivery_proof', 'have'),
  ('74000000-0000-4000-8000-000000000014', '74000000-0000-4000-8000-000000000003', 'acceptance_reply', 'have'),
  ('74000000-0000-4000-8000-000000000015', '74000000-0000-4000-8000-000000000003', 'ledger', 'have'),
  ('74000000-0000-4000-8000-000000000016', '74000000-0000-4000-8000-000000000003', 'communications', 'have'),
  ('74000000-0000-4000-8000-000000000017', '74000000-0000-4000-8000-000000000003', 'udyam_cert', 'have')
on conflict (case_id, kind) do update set
  status = excluded.status;

-- Scenario 5: Agreed payment date within the statutory 45-day cap + pending promise
-- (Apex Pumps and Motors Ltd — PO 1).
-- UI/Copilot demo: uses the written 05 Sep 2026 payment term; buyer promised on 22 Oct
-- to settle Rs 1,50,000.00 by 28 Oct 2026, triggering R4-promise-pending (await_promise).
insert into buyers (id, business_id, name, gstin, is_cpse, relationship_importance)
values ('75000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
        'Apex Pumps and Motors Ltd', '29AAACA6521K1ZN', false, 'medium')
on conflict (id) do update set
  business_id = excluded.business_id, name = excluded.name, gstin = excluded.gstin,
  is_cpse = excluded.is_cpse, relationship_importance = excluded.relationship_importance;

insert into cases (id, business_id, buyer_id, contract_date, status, ladder_step, allocation, po_amount, dispute_reason)
values ('75000000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111',
        '75000000-0000-4000-8000-000000000002', '2026-07-20', 'active', 1, 'interest_first', 150000.00, 'none')
on conflict (id) do update set
  business_id = excluded.business_id, buyer_id = excluded.buyer_id, contract_date = excluded.contract_date,
  status = excluded.status, ladder_step = excluded.ladder_step, allocation = excluded.allocation,
  po_amount = excluded.po_amount, dispute_reason = excluded.dispute_reason;

insert into invoices (id, case_id, number, invoice_date, amount, delivery_date, agreed_due_date,
                      objection_date, objection_removed_date)
values ('75000000-0000-4000-8000-000000000004', '75000000-0000-4000-8000-000000000003',
        'KIC-2608-063', '2026-08-05', 150000.00, '2026-08-06', '2026-09-05', null, null)
on conflict (id) do update set
  case_id = excluded.case_id, number = excluded.number, invoice_date = excluded.invoice_date,
  amount = excluded.amount, delivery_date = excluded.delivery_date, agreed_due_date = excluded.agreed_due_date,
  objection_date = excluded.objection_date, objection_removed_date = excluded.objection_removed_date;

insert into followups (id, case_id, step, sent_on, reply_received, note)
values ('75000000-0000-4000-8000-000000000006', '75000000-0000-4000-8000-000000000003',
        1, '2026-10-21', true, 'Gentle reminder sent; accounts team confirmed NEFT scheduled for 28 Oct.')
on conflict (id) do update set
  case_id = excluded.case_id, step = excluded.step, sent_on = excluded.sent_on,
  reply_received = excluded.reply_received, note = excluded.note;

insert into promises (id, case_id, made_on, due_date, amount, source_text)
values ('75000000-0000-4000-8000-000000000007', '75000000-0000-4000-8000-000000000003',
        '2026-10-22', '2026-10-28', 150000.00, 'Payment of Rs 1,50,000 approved in this week''s run; NEFT by 28 Oct.')
on conflict (id) do update set
  case_id = excluded.case_id, made_on = excluded.made_on, due_date = excluded.due_date,
  amount = excluded.amount, source_text = excluded.source_text;

insert into evidence_items (id, case_id, kind, status) values
  ('75000000-0000-4000-8000-000000000011', '75000000-0000-4000-8000-000000000003', 'po', 'have'),
  ('75000000-0000-4000-8000-000000000012', '75000000-0000-4000-8000-000000000003', 'invoice', 'have'),
  ('75000000-0000-4000-8000-000000000013', '75000000-0000-4000-8000-000000000003', 'delivery_proof', 'have'),
  ('75000000-0000-4000-8000-000000000014', '75000000-0000-4000-8000-000000000003', 'acceptance_reply', 'have'),
  ('75000000-0000-4000-8000-000000000015', '75000000-0000-4000-8000-000000000003', 'ledger', 'have'),
  ('75000000-0000-4000-8000-000000000016', '75000000-0000-4000-8000-000000000003', 'communications', 'have'),
  ('75000000-0000-4000-8000-000000000017', '75000000-0000-4000-8000-000000000003', 'udyam_cert', 'have')
on conflict (case_id, kind) do update set
  status = excluded.status;

-- Scenario 6: Historical Q1 PO for Kaveri Foods Pvt Ltd ('22222222-2222-2222-2222-222222222222').
-- UI/Copilot demo: gives Kaveri Foods 5 total invoices (3 settled in Q1 + 2 overdue in Case 1)
-- so Buyer Insights shows full reliability metrics (on-time rate, average delay, monthly chart).
-- INV-088 and INV-094 were paid on time; INV-102 was paid 9 days late along with its
-- 8 days of accrued s.16 interest (Rs 253.15), leaving Rs 0.00 outstanding.
insert into cases (id, business_id, buyer_id, contract_date, status, ladder_step, allocation, po_amount, dispute_reason)
values ('76000000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222', '2026-01-05', 'settled', 0, 'interest_first', 210000.00, 'none')
on conflict (id) do update set
  business_id = excluded.business_id, buyer_id = excluded.buyer_id, contract_date = excluded.contract_date,
  status = excluded.status, ladder_step = excluded.ladder_step, allocation = excluded.allocation,
  po_amount = excluded.po_amount, dispute_reason = excluded.dispute_reason;

insert into invoices (id, case_id, number, invoice_date, amount, delivery_date, agreed_due_date,
                      objection_date, objection_removed_date) values
  ('76000000-0000-4000-8000-000000000004', '76000000-0000-4000-8000-000000000003',
   'INV-088', '2026-01-10', 75000.00, '2026-01-11', '2026-01-26', null, null),
  ('76000000-0000-4000-8000-000000000005', '76000000-0000-4000-8000-000000000003',
   'INV-094', '2026-01-28', 65000.00, '2026-01-29', '2026-02-13', null, null),
  ('76000000-0000-4000-8000-000000000006', '76000000-0000-4000-8000-000000000003',
   'INV-102', '2026-02-08', 70000.00, '2026-02-09', '2026-02-24', null, null)
on conflict (id) do update set
  case_id = excluded.case_id, number = excluded.number, invoice_date = excluded.invoice_date,
  amount = excluded.amount, delivery_date = excluded.delivery_date, agreed_due_date = excluded.agreed_due_date,
  objection_date = excluded.objection_date, objection_removed_date = excluded.objection_removed_date;

insert into payments (id, invoice_id, paid_on, amount) values
  ('76000000-0000-4000-8000-000000000007', '76000000-0000-4000-8000-000000000004',
   '2026-01-26', 75000.00),
  ('76000000-0000-4000-8000-000000000008', '76000000-0000-4000-8000-000000000005',
   '2026-02-13', 65000.00),
  ('76000000-0000-4000-8000-000000000009', '76000000-0000-4000-8000-000000000006',
   '2026-03-05', 70253.15)
on conflict (id) do update set
  invoice_id = excluded.invoice_id, paid_on = excluded.paid_on, amount = excluded.amount;

insert into evidence_items (id, case_id, kind, status) values
  ('76000000-0000-4000-8000-000000000011', '76000000-0000-4000-8000-000000000003', 'po', 'have'),
  ('76000000-0000-4000-8000-000000000012', '76000000-0000-4000-8000-000000000003', 'invoice', 'have'),
  ('76000000-0000-4000-8000-000000000013', '76000000-0000-4000-8000-000000000003', 'delivery_proof', 'have'),
  ('76000000-0000-4000-8000-000000000014', '76000000-0000-4000-8000-000000000003', 'acceptance_reply', 'have'),
  ('76000000-0000-4000-8000-000000000015', '76000000-0000-4000-8000-000000000003', 'ledger', 'have'),
  ('76000000-0000-4000-8000-000000000016', '76000000-0000-4000-8000-000000000003', 'communications', 'have'),
  ('76000000-0000-4000-8000-000000000017', '76000000-0000-4000-8000-000000000003', 'udyam_cert', 'have')
on conflict (case_id, kind) do update set
  status = excluded.status;

-- Scenario 7: Upcoming due dates (Apex Pumps and Motors Ltd — PO 2).
-- UI/Copilot demo: populates the Dashboard "Upcoming payment dates" card as of 2026-10-25
-- with INV-198 due 2026-10-29 (4 days left, due_soon) and INV-204 due 2026-11-12
-- (18 days left, not_due), triggering R3-not-due ("Wait until the due date").
insert into cases (id, business_id, buyer_id, contract_date, status, ladder_step, allocation, po_amount, dispute_reason)
values ('77000000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111',
        '75000000-0000-4000-8000-000000000002', '2026-09-25', 'active', 0, 'interest_first', 240000.00, 'none')
on conflict (id) do update set
  business_id = excluded.business_id, buyer_id = excluded.buyer_id, contract_date = excluded.contract_date,
  status = excluded.status, ladder_step = excluded.ladder_step, allocation = excluded.allocation,
  po_amount = excluded.po_amount, dispute_reason = excluded.dispute_reason;

insert into invoices (id, case_id, number, invoice_date, amount, delivery_date, agreed_due_date,
                      objection_date, objection_removed_date) values
  ('77000000-0000-4000-8000-000000000004', '77000000-0000-4000-8000-000000000003',
   'INV-198', '2026-09-28', 150000.00, '2026-09-29', '2026-10-29', null, null),
  ('77000000-0000-4000-8000-000000000005', '77000000-0000-4000-8000-000000000003',
   'INV-204', '2026-10-12', 90000.00, '2026-10-13', '2026-11-12', null, null)
on conflict (id) do update set
  case_id = excluded.case_id, number = excluded.number, invoice_date = excluded.invoice_date,
  amount = excluded.amount, delivery_date = excluded.delivery_date, agreed_due_date = excluded.agreed_due_date,
  objection_date = excluded.objection_date, objection_removed_date = excluded.objection_removed_date;

insert into evidence_items (id, case_id, kind, status) values
  ('77000000-0000-4000-8000-000000000011', '77000000-0000-4000-8000-000000000003', 'po', 'have'),
  ('77000000-0000-4000-8000-000000000012', '77000000-0000-4000-8000-000000000003', 'invoice', 'have'),
  ('77000000-0000-4000-8000-000000000013', '77000000-0000-4000-8000-000000000003', 'delivery_proof', 'have'),
  ('77000000-0000-4000-8000-000000000014', '77000000-0000-4000-8000-000000000003', 'acceptance_reply', 'have'),
  ('77000000-0000-4000-8000-000000000015', '77000000-0000-4000-8000-000000000003', 'ledger', 'have'),
  ('77000000-0000-4000-8000-000000000016', '77000000-0000-4000-8000-000000000003', 'communications', 'have'),
  ('77000000-0000-4000-8000-000000000017', '77000000-0000-4000-8000-000000000003', 'udyam_cert', 'have')
on conflict (case_id, kind) do update set
  status = excluded.status;

-- Scenario 8: Agreed credit period longer than the law allows (Deccan Agro Exports Pvt Ltd).
-- UI/Copilot demo: the PO says "payment 90 days" (agreed date 20 Sep 2026), but Section 15
-- caps any agreed period at 45 days from acceptance, so payment was due by 6 Aug 2026 and
-- interest runs from 7 Aug. The buyer's reply quoting its 90-day terms is in the follow-ups.
insert into buyers (id, business_id, name, gstin, is_cpse, relationship_importance)
values ('78000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
        'Deccan Agro Exports Pvt Ltd', '36AAECD5517F1Z9', false, 'medium')
on conflict (id) do update set
  business_id = excluded.business_id, name = excluded.name, gstin = excluded.gstin,
  is_cpse = excluded.is_cpse, relationship_importance = excluded.relationship_importance;

insert into cases (id, business_id, buyer_id, contract_date, status, ladder_step, allocation, po_amount, dispute_reason)
values ('78000000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111',
        '78000000-0000-4000-8000-000000000002', '2026-06-15', 'active', 1, 'interest_first', 180000.00, 'none')
on conflict (id) do update set
  business_id = excluded.business_id, buyer_id = excluded.buyer_id, contract_date = excluded.contract_date,
  status = excluded.status, ladder_step = excluded.ladder_step, allocation = excluded.allocation,
  po_amount = excluded.po_amount, dispute_reason = excluded.dispute_reason;

insert into invoices (id, case_id, number, invoice_date, amount, delivery_date, agreed_due_date,
                      objection_date, objection_removed_date)
values ('78000000-0000-4000-8000-000000000004', '78000000-0000-4000-8000-000000000003',
        'INV-162', '2026-06-20', 180000.00, '2026-06-22', '2026-09-20', null, null)
on conflict (id) do update set
  case_id = excluded.case_id, number = excluded.number, invoice_date = excluded.invoice_date,
  amount = excluded.amount, delivery_date = excluded.delivery_date, agreed_due_date = excluded.agreed_due_date,
  objection_date = excluded.objection_date, objection_removed_date = excluded.objection_removed_date;

insert into followups (id, case_id, step, sent_on, reply_received, note)
values ('78000000-0000-4000-8000-000000000006', '78000000-0000-4000-8000-000000000003',
        1, '2026-09-25', true, 'Buyer replied: ''Our PO terms are 90 days; payment will be processed in the October run.''')
on conflict (id) do update set
  case_id = excluded.case_id, step = excluded.step, sent_on = excluded.sent_on,
  reply_received = excluded.reply_received, note = excluded.note;

insert into evidence_items (id, case_id, kind, status) values
  ('78000000-0000-4000-8000-000000000011', '78000000-0000-4000-8000-000000000003', 'po', 'have'),
  ('78000000-0000-4000-8000-000000000012', '78000000-0000-4000-8000-000000000003', 'invoice', 'have'),
  ('78000000-0000-4000-8000-000000000013', '78000000-0000-4000-8000-000000000003', 'delivery_proof', 'have'),
  ('78000000-0000-4000-8000-000000000014', '78000000-0000-4000-8000-000000000003', 'acceptance_reply', 'have'),
  ('78000000-0000-4000-8000-000000000015', '78000000-0000-4000-8000-000000000003', 'ledger', 'have'),
  ('78000000-0000-4000-8000-000000000016', '78000000-0000-4000-8000-000000000003', 'communications', 'have'),
  ('78000000-0000-4000-8000-000000000017', '78000000-0000-4000-8000-000000000003', 'udyam_cert', 'have')
on conflict (case_id, kind) do update set
  status = excluded.status;

-- Suppliers 2 and 3 (generated from backend/app/demo_extra.py; all names fictional).
insert into businesses (id, name, phone, udyam_no, size, activity, udyam_registered, udyam_reg_date, description, email, address, gstin, pan, established_year, products, team, documents) values
  ('81000000-0000-4000-8000-000000000001', 'Arunodaya Precision Components', '+919845001102', 'UDYAM-TN-11-0048213', 'micro', 'manufacturing', true, '2021-09-03', 'CNC-machined brackets, flanges and pump housings for auto and heavy-engineering buyers.', 'accounts@arunodaya.example', 'Plot 7, SIPCOT Phase II, Hosur 635109, Tamil Nadu', '33AQKPA4471M1ZR', 'AQKPA4471M', '2014', '["CNC machined brackets", "Pump housings", "Flanges"]'::jsonb, '[{"name": "Karthik Arumugam", "role": "Owner", "email": "karthik@arunodaya.example"}]'::jsonb, '{"udyam_certificate": "have", "gst_certificate": "have", "pan_card": "have", "address_proof": "have", "bank_details": "have"}'::jsonb),
  ('82000000-0000-4000-8000-000000000001', 'Thenmozhi Knit Works', '+919843002203', 'UDYAM-TN-32-0091547', 'small', 'services', true, '2026-03-15', 'Knitting and stitching job work: uniforms and T-shirts made from buyers'' fabric.', 'office@thenmozhiknit.example', '12 Kumar Nagar South, Tiruppur 641603, Tamil Nadu', '33BDTPT8820K1ZS', 'BDTPT8820K', '2011', '["Uniform stitching", "T-shirt job work", "Knitting"]'::jsonb, '[{"name": "Thenmozhi Selvaraj", "role": "Owner", "email": "thenmozhi@thenmozhiknit.example"}]'::jsonb, '{"udyam_certificate": "have", "gst_certificate": "have", "pan_card": "have", "address_proof": "unknown", "bank_details": "have"}'::jsonb)
on conflict (id) do update set name = excluded.name, phone = excluded.phone, udyam_no = excluded.udyam_no, size = excluded.size, activity = excluded.activity, udyam_registered = excluded.udyam_registered, udyam_reg_date = excluded.udyam_reg_date, description = excluded.description, email = excluded.email, address = excluded.address, gstin = excluded.gstin, pan = excluded.pan, established_year = excluded.established_year, products = excluded.products, team = excluded.team, documents = excluded.documents;

insert into buyers (id, business_id, name, gstin, is_cpse, relationship_importance) values
  ('81000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', 'Velan Auto Systems Pvt Ltd', '33AABCV5521R1Z0', false, 'high'),
  ('81000000-0000-4000-8000-000000000012', '81000000-0000-4000-8000-000000000001', 'Bharat Heavy Castings Ltd', '29AAACB3108G1Z2', true, 'medium'),
  ('82000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', 'Kaveri Foods Pvt Ltd', null, false, 'high'),
  ('82000000-0000-4000-8000-000000000012', '82000000-0000-4000-8000-000000000001', 'Coastline Apparel Exports LLP', '33AAQFC6609H1ZC', false, 'medium')
on conflict (id) do update set business_id = excluded.business_id, name = excluded.name, gstin = excluded.gstin, is_cpse = excluded.is_cpse, relationship_importance = excluded.relationship_importance;

insert into cases (id, business_id, buyer_id, contract_date, status, ladder_step, allocation, po_amount, dispute_reason) values
  ('81000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', '2026-01-12', 'active', '1', 'principal_first', '320000.00', 'none'),
  ('81000000-0000-4000-8000-000000000013', '81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000012', '2026-03-02', 'active', '3', 'interest_first', '410000.00', 'none'),
  ('82000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002', '2026-02-10', 'active', '1', 'interest_first', '138000.00', 'none'),
  ('82000000-0000-4000-8000-000000000013', '82000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000012', '2026-07-01', 'active', '1', 'interest_first', '246000.00', 'quality')
on conflict (id) do update set business_id = excluded.business_id, buyer_id = excluded.buyer_id, contract_date = excluded.contract_date, status = excluded.status, ladder_step = excluded.ladder_step, allocation = excluded.allocation, po_amount = excluded.po_amount, dispute_reason = excluded.dispute_reason;

insert into invoices (id, case_id, number, invoice_date, amount, delivery_date, agreed_due_date, objection_date, objection_removed_date) values
  ('81000000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000003', 'APC/25-26/0412', '2026-01-20', '160000.00', '2026-01-21', '2026-02-20', null, null),
  ('81000000-0000-4000-8000-000000000005', '81000000-0000-4000-8000-000000000003', 'APC/25-26/0447', '2026-02-16', '160000.00', '2026-02-17', '2026-03-19', null, null),
  ('81000000-0000-4000-8000-000000000014', '81000000-0000-4000-8000-000000000013', 'APC/26-27/0031', '2026-04-06', '205000.00', '2026-04-08', null, null, null),
  ('81000000-0000-4000-8000-000000000015', '81000000-0000-4000-8000-000000000013', 'APC/26-27/0058', '2026-05-11', '205000.00', '2026-05-12', null, null, null),
  ('82000000-0000-4000-8000-000000000004', '82000000-0000-4000-8000-000000000003', 'TKW-118', '2026-03-28', '138000.00', '2026-03-30', '2026-04-29', null, null),
  ('82000000-0000-4000-8000-000000000014', '82000000-0000-4000-8000-000000000013', 'TKW-163', '2026-07-01', '246000.00', '2026-07-02', '2026-08-01', '2026-07-09', null)
on conflict (id) do update set case_id = excluded.case_id, number = excluded.number, invoice_date = excluded.invoice_date, amount = excluded.amount, delivery_date = excluded.delivery_date, agreed_due_date = excluded.agreed_due_date, objection_date = excluded.objection_date, objection_removed_date = excluded.objection_removed_date;

insert into payments (id, invoice_id, paid_on, amount) values
  ('81000000-0000-4000-8000-000000000006', '81000000-0000-4000-8000-000000000004', '2026-05-08', '160000.00'),
  ('81000000-0000-4000-8000-000000000007', '81000000-0000-4000-8000-000000000005', '2026-06-12', '160000.00'),
  ('81000000-0000-4000-8000-000000000016', '81000000-0000-4000-8000-000000000014', '2026-07-20', '100000.00'),
  ('82000000-0000-4000-8000-000000000005', '82000000-0000-4000-8000-000000000004', '2026-06-15', '40000.00')
on conflict (id) do update set invoice_id = excluded.invoice_id, paid_on = excluded.paid_on, amount = excluded.amount;

insert into promises (id, case_id, made_on, due_date, amount, source_text) values
  ('82000000-0000-4000-8000-000000000006', '82000000-0000-4000-8000-000000000003', '2026-09-18', '2026-10-10', '98000.00', 'Madam, balance 98,000 will be cleared before Dussehra, 10th Oct.')
on conflict (id) do update set case_id = excluded.case_id, made_on = excluded.made_on, due_date = excluded.due_date, amount = excluded.amount, source_text = excluded.source_text;

insert into followups (id, case_id, step, sent_on, reply_received, note) values
  ('81000000-0000-4000-8000-000000000008', '81000000-0000-4000-8000-000000000003', '1', '2026-04-10', true, 'Velan accounts: ''Bills are in the vendor payment cycle, will release in May.'' Paid in May and June.'),
  ('81000000-0000-4000-8000-000000000017', '81000000-0000-4000-8000-000000000013', '2', '2026-08-05', true, 'Finance dept: ''File is pending for approval with the competent authority.'' Rs 1,00,000 released on 20 Jul only.'),
  ('81000000-0000-4000-8000-000000000018', '81000000-0000-4000-8000-000000000013', '2', '2026-09-22', false, 'Second firm reminder by email and speed post; no reply.'),
  ('82000000-0000-4000-8000-000000000007', '82000000-0000-4000-8000-000000000003', '1', '2026-09-16', true, 'Kaveri purchase team confirmed balance before Dussehra.'),
  ('82000000-0000-4000-8000-000000000015', '82000000-0000-4000-8000-000000000013', '1', '2026-07-14', true, 'Coastline QC email: 420 of 3,000 pieces rejected for shade variation; rest accepted. Asked for a credit note on the rejected pieces.')
on conflict (id) do update set case_id = excluded.case_id, step = excluded.step, sent_on = excluded.sent_on, reply_received = excluded.reply_received, note = excluded.note;

insert into evidence_items (id, case_id, kind, status) values
  ('81000000-0000-4000-8000-000000000101', '81000000-0000-4000-8000-000000000003', 'po', 'have'),
  ('81000000-0000-4000-8000-000000000102', '81000000-0000-4000-8000-000000000003', 'invoice', 'have'),
  ('81000000-0000-4000-8000-000000000103', '81000000-0000-4000-8000-000000000003', 'delivery_proof', 'have'),
  ('81000000-0000-4000-8000-000000000104', '81000000-0000-4000-8000-000000000003', 'acceptance_reply', 'have'),
  ('81000000-0000-4000-8000-000000000105', '81000000-0000-4000-8000-000000000003', 'ledger', 'have'),
  ('81000000-0000-4000-8000-000000000106', '81000000-0000-4000-8000-000000000003', 'communications', 'have'),
  ('81000000-0000-4000-8000-000000000107', '81000000-0000-4000-8000-000000000003', 'udyam_cert', 'have'),
  ('81000000-0000-4000-8000-000000000111', '81000000-0000-4000-8000-000000000013', 'po', 'have'),
  ('81000000-0000-4000-8000-000000000112', '81000000-0000-4000-8000-000000000013', 'invoice', 'have'),
  ('81000000-0000-4000-8000-000000000113', '81000000-0000-4000-8000-000000000013', 'delivery_proof', 'have'),
  ('81000000-0000-4000-8000-000000000114', '81000000-0000-4000-8000-000000000013', 'acceptance_reply', 'have'),
  ('81000000-0000-4000-8000-000000000115', '81000000-0000-4000-8000-000000000013', 'ledger', 'have'),
  ('81000000-0000-4000-8000-000000000116', '81000000-0000-4000-8000-000000000013', 'communications', 'have'),
  ('81000000-0000-4000-8000-000000000117', '81000000-0000-4000-8000-000000000013', 'udyam_cert', 'have'),
  ('82000000-0000-4000-8000-000000000101', '82000000-0000-4000-8000-000000000003', 'po', 'have'),
  ('82000000-0000-4000-8000-000000000102', '82000000-0000-4000-8000-000000000003', 'invoice', 'have'),
  ('82000000-0000-4000-8000-000000000103', '82000000-0000-4000-8000-000000000003', 'delivery_proof', 'have'),
  ('82000000-0000-4000-8000-000000000104', '82000000-0000-4000-8000-000000000003', 'acceptance_reply', 'missing'),
  ('82000000-0000-4000-8000-000000000105', '82000000-0000-4000-8000-000000000003', 'ledger', 'have'),
  ('82000000-0000-4000-8000-000000000106', '82000000-0000-4000-8000-000000000003', 'communications', 'have'),
  ('82000000-0000-4000-8000-000000000107', '82000000-0000-4000-8000-000000000003', 'udyam_cert', 'have'),
  ('82000000-0000-4000-8000-000000000111', '82000000-0000-4000-8000-000000000013', 'po', 'have'),
  ('82000000-0000-4000-8000-000000000112', '82000000-0000-4000-8000-000000000013', 'invoice', 'have'),
  ('82000000-0000-4000-8000-000000000113', '82000000-0000-4000-8000-000000000013', 'delivery_proof', 'have'),
  ('82000000-0000-4000-8000-000000000114', '82000000-0000-4000-8000-000000000013', 'acceptance_reply', 'have'),
  ('82000000-0000-4000-8000-000000000115', '82000000-0000-4000-8000-000000000013', 'ledger', 'missing'),
  ('82000000-0000-4000-8000-000000000116', '82000000-0000-4000-8000-000000000013', 'communications', 'have'),
  ('82000000-0000-4000-8000-000000000117', '82000000-0000-4000-8000-000000000013', 'udyam_cert', 'have')
on conflict (case_id, kind) do update set id = excluded.id, status = excluded.status;


-- -----------------------------------------------------------------------------
-- DEMO ACCOUNTS (run by hand in the Supabase SQL Editor, AFTER registering these accounts in
-- the app and verifying their emails; replace the emails with the ones you used):
--
--   supplier-sri@...     MSME supplier   -> owns Sri Lakshmi Packaging
--   supplier-hosur@...   MSME supplier   -> owns Arunodaya Precision Components   (optional)
--   supplier-knit@...    MSME supplier   -> owns Thenmozhi Knit Works              (optional)
--   buyer-kaveri@...     Buyer           -> sees invoices raised to Kaveri Foods by two suppliers
--   adviser@...          Adviser         -> approve in /admin first, then sees four shared cases
--
-- update public.businesses set owner_id = (select id from public.profiles where email = 'supplier-sri@example.com')
--  where id = '11111111-1111-1111-1111-111111111111';
-- update public.businesses set owner_id = (select id from public.profiles where email = 'supplier-hosur@example.com')
--  where id = '81000000-0000-4000-8000-000000000001';
-- update public.businesses set owner_id = (select id from public.profiles where email = 'supplier-knit@example.com')
--  where id = '82000000-0000-4000-8000-000000000001';
--
-- update public.buyers set account_id = (select id from public.profiles where email = 'buyer-kaveri@example.com' and role = 'buyer')
--  where id in ('22222222-2222-2222-2222-222222222222', '82000000-0000-4000-8000-000000000002');
--
-- insert into public.case_shares (case_id, adviser_id)
-- select c.id, p.id from public.profiles p,
--   unnest(array['33333333-3333-3333-3333-333333333333', '73000000-0000-4000-8000-000000000003',
--                 '81000000-0000-4000-8000-000000000013', '82000000-0000-4000-8000-000000000003']::uuid[]) as c(id)
--  where p.email = 'adviser@example.com' and p.role = 'adviser' and p.approval_status = 'approved'
-- on conflict do nothing;
-- -----------------------------------------------------------------------------
