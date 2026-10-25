-- 007_payment_blockers.sql
-- Records the reason a buyer gives for not paying, the supplier's evidence
-- of that reason, and when (if ever) the blocker was resolved.
-- RLS mirrors case_shares: only the supplier who owns the case may read/write.

create table public.payment_blockers (
    id              uuid        primary key default gen_random_uuid(),
    case_id         uuid        not null references public.cases(id) on delete cascade,
    invoice_id      uuid                    references public.invoices(id) on delete set null,

    -- Reason codes (kept as a check constraint so the app never stores free-form
    -- rubbish; the note field carries additional detail).
    reason          text        not null
        check (reason in (
            'po_missing',
            'grn_not_entered',
            'amount_mismatch',
            'quality_dispute',
            'waiting_approval',
            'other'
        )),

    -- How well the supplier can prove the reason was actually stated.
    source          text        not null default 'not_verified'
        check (source in ('buyer_said', 'documented', 'not_verified')),

    disputed_amount numeric(14,2),
    note            text        check (char_length(note) <= 1000),
    reported_on     date        not null default current_date,
    resolved_on     date,
    created_at      timestamptz not null default now()
);

-- Fastest lookup: all open blockers for a case.
create index payment_blockers_case_id_idx on public.payment_blockers (case_id);

-- RLS: a supplier can only touch blockers that belong to their own cases.
alter table public.payment_blockers enable row level security;

create policy supplier_own_blockers
    on public.payment_blockers
    for all
    using (
        exists (
            select 1
            from   public.cases c
            join   public.businesses b on b.id = c.business_id
            where  c.id = payment_blockers.case_id
            and    b.owner_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1
            from   public.cases c
            join   public.businesses b on b.id = c.business_id
            where  c.id = payment_blockers.case_id
            and    b.owner_id = auth.uid()
        )
    );

-- Advisers who have been shared the case may read (but not write) blockers.
create policy adviser_shared_blockers
    on public.payment_blockers
    for select
    using (
        exists (
            select 1
            from   public.case_shares cs
            join   public.profiles   p on p.id = cs.adviser_id
            where  cs.case_id = payment_blockers.case_id
            and    p.id = auth.uid()
            and    p.role = 'adviser'
            and    p.approval_status = 'approved'
        )
    );

comment on table public.payment_blockers is
    'Reasons a buyer gives for not paying an invoice, recorded by the supplier. '
    'Blockers do not change the statutory due date or interest calculation; '
    'they surface a suggested fix in the copilot next-action engine.';
