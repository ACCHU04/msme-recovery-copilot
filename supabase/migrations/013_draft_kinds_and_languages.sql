-- Settle45: let drafts store every kind the app produces, and Kannada / Hindi letters (C3).
-- Run after 012. Migration 001 allowed only nudge, firm, demand and acceptance_confirm, so
-- saving a payment-blocker or dispute draft failed on a real database.
alter table public.drafts drop constraint if exists drafts_kind_check;
alter table public.drafts add constraint drafts_kind_check check (kind in (
  'acceptance_confirm', 'nudge', 'firm', 'demand',
  'fix_blocker_po', 'fix_blocker_grn', 'fix_blocker_amount', 'resolve_dispute', 'fix_blocker'));

alter table public.drafts drop constraint if exists drafts_lang_check;
alter table public.drafts add constraint drafts_lang_check check (lang in ('en', 'kn', 'hi'));

alter table public.businesses drop constraint if exists businesses_preferred_lang_check;
alter table public.businesses add constraint businesses_preferred_lang_check check (preferred_lang in ('en', 'kn', 'hi'));
