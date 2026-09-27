-- Separate spending purchases from cash-flow repayments without rewriting history.
-- Legacy invoice_advance notes remain readable through the application mapper.

begin;

alter table public.transactions
  add column if not exists entry_kind text not null default 'purchase';
alter table public.transactions
  add column if not exists related_invoice_id text;
alter table public.transactions
  add column if not exists entry_idempotency_key text;

alter table public.transactions
  drop constraint if exists transactions_entry_kind_check;
alter table public.transactions
  add constraint transactions_entry_kind_check
  check (entry_kind in ('purchase', 'repayment', 'refund', 'transfer'));

create unique index if not exists transactions_entry_idempotency_idx
  on public.transactions (user_id, entry_kind, entry_idempotency_key)
  where entry_idempotency_key is not null;

create index if not exists transactions_related_invoice_idx
  on public.transactions (user_id, related_invoice_id)
  where related_invoice_id is not null;

commit;
