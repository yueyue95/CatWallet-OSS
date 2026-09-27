-- Count fun money from an explicit transaction label, never from category names.
alter table public.transactions
  add column if not exists counts_toward_fun_money boolean not null default false;

alter table public.transactions
  add constraint transactions_fun_money_expense_only_check
  check (kind = 'expense' or counts_toward_fun_money = false);

create index if not exists transactions_fun_money_month_idx
on public.transactions (user_id, date)
where counts_toward_fun_money = true and deleted_at is null;
;
