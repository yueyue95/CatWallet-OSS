-- Add an explicit lifecycle marker for MCP installment completion.
-- Historical transaction rows remain intact; completion only stops the plan
-- from being presented as active.

begin;

set local lock_timeout = '5s';

alter table public.transactions
  add column if not exists installment_completed_at timestamptz;

create index if not exists transactions_installment_lifecycle_idx
  on public.transactions (user_id, installment_group_id, installment_completed_at)
  where installment_group_id is not null;

commit;
