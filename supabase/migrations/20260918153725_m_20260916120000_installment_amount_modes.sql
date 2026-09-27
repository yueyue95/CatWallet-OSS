-- Make the user's installment entry semantics explicit while preserving old rows.
alter table public.transactions
  add column if not exists installment_amount_mode text,
  add column if not exists installment_amount numeric,
  add column if not exists installment_current_number integer;

alter table public.transactions
  add constraint transactions_installment_amount_mode_check
  check (installment_amount_mode is null or installment_amount_mode in ('per_installment', 'total'));

alter table public.transactions
  add constraint transactions_installment_amount_positive
  check (installment_amount is null or installment_amount > 0);

alter table public.transactions
  add constraint transactions_installment_current_number_check
  check (
    installment_current_number is null
    or (installment_current_number >= 1 and installment_current_number <= installment_total)
  );

-- Existing generated rows were created from a total amount and rounded only on
-- the final occurrence. Keep that behavior and make it explicit.
update public.transactions as transaction_row
set installment_amount_mode = 'total',
    installment_amount = group_totals.total_amount
from (
  select installment_group_id, sum(abs(amount)) as total_amount
  from public.transactions
  where installment_group_id is not null
  group by installment_group_id
) as group_totals
where transaction_row.installment_group_id = group_totals.installment_group_id
  and transaction_row.installment_amount_mode is null;

create index if not exists transactions_installment_mode_idx
  on public.transactions (user_id, installment_group_id, installment_amount_mode)
  where installment_group_id is not null;
;
