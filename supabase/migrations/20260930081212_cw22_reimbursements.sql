-- Model reimbursements as account cash flow that offsets personal spending
-- without becoming ordinary income or reducing the original card purchase.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.transactions
  add column related_transaction_id uuid references public.transactions(id);

alter table public.transactions
  drop constraint if exists transactions_entry_kind_check;
alter table public.transactions
  add constraint transactions_entry_kind_check
  check (
    entry_kind in ('purchase', 'repayment', 'refund', 'reimbursement', 'transfer')
  );

alter table public.transactions
  add constraint transactions_reimbursement_shape_check
  check (
    (entry_kind = 'reimbursement' and kind = 'income' and related_transaction_id is not null)
    or (entry_kind <> 'reimbursement' and related_transaction_id is null)
  );

create index transactions_related_transaction_idx
  on public.transactions (user_id, related_transaction_id)
  where related_transaction_id is not null;

create or replace function private.validate_reimbursement_relationship()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_original_amount numeric;
  v_reimbursed_amount numeric;
begin
  if new.entry_kind = 'reimbursement' and new.deleted_at is null then
    select original.amount
    into v_original_amount
    from public.transactions as original
    where original.id = new.related_transaction_id
      and original.user_id = new.user_id
      and original.deleted_at is null
      and original.kind = 'expense'
      and original.entry_kind not in ('repayment', 'transfer')
    for update;

    if v_original_amount is null then
      raise exception 'invalid original expense for reimbursement owner';
    end if;

    select coalesce(sum(existing.amount), 0)
    into v_reimbursed_amount
    from public.transactions as existing
    where existing.user_id = new.user_id
      and existing.entry_kind = 'reimbursement'
      and existing.related_transaction_id = new.related_transaction_id
      and existing.deleted_at is null
      and existing.id <> new.id;

    if v_reimbursed_amount + new.amount > abs(v_original_amount) then
      raise exception 'reimbursement total exceeds original expense';
    end if;
  elsif tg_op = 'UPDATE'
    and old.deleted_at is null
    and new.deleted_at is not null
    and exists (
    select 1
    from public.transactions as reimbursement
    where reimbursement.user_id = new.user_id
      and reimbursement.related_transaction_id = new.id
      and reimbursement.entry_kind = 'reimbursement'
      and reimbursement.deleted_at is null
  ) then
    raise exception 'delete active reimbursements before deleting the original expense';
  end if;

  return new;
end;
$$;

drop trigger if exists transactions_validate_reimbursement_relationship
on public.transactions;
create trigger transactions_validate_reimbursement_relationship
before insert or update of
  user_id, amount, kind, entry_kind, related_transaction_id, deleted_at
on public.transactions
for each row execute function private.validate_reimbursement_relationship();

create or replace function public.create_reimbursement(
  p_transaction_id uuid,
  p_idempotency_key text,
  p_original_transaction_id uuid,
  p_description text,
  p_notes text,
  p_amount numeric,
  p_date date,
  p_payment_method_id uuid
)
returns table (
  created_transaction_id uuid,
  replayed boolean
)
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.transactions%rowtype;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_amount <= 0 or nullif(trim(p_idempotency_key), '') is null then
    raise exception 'invalid reimbursement amount or idempotency key';
  end if;

  select transaction.*
  into v_existing
  from public.transactions as transaction
  where transaction.user_id = v_user_id
    and transaction.entry_kind = 'reimbursement'
    and transaction.entry_idempotency_key = p_idempotency_key;

  if found then
    if v_existing.amount <> p_amount
      or v_existing.date <> p_date
      or v_existing.payment_method_id is distinct from p_payment_method_id
      or v_existing.related_transaction_id <> p_original_transaction_id then
      raise exception 'idempotency key was already used for a different reimbursement';
    end if;
    return query select v_existing.id, true;
    return;
  end if;

  insert into public.transactions (
    id, user_id, date, description, amount, kind, payment_method_id,
    notes, entry_kind, entry_idempotency_key, related_transaction_id
  ) values (
    p_transaction_id, v_user_id, p_date, p_description, p_amount, 'income',
    p_payment_method_id, p_notes, 'reimbursement', p_idempotency_key,
    p_original_transaction_id
  );

  return query select p_transaction_id, false;
end;
$$;

revoke all on function public.create_reimbursement(
  uuid, text, uuid, text, text, numeric, date, uuid
) from public;
revoke all on function public.create_reimbursement(
  uuid, text, uuid, text, text, numeric, date, uuid
) from anon;
grant execute on function public.create_reimbursement(
  uuid, text, uuid, text, text, numeric, date, uuid
) to authenticated;

create or replace function public.calculate_total_saved(p_selected_month date)
returns numeric
language sql
stable
set search_path = public
as $$
  with month_bounds as (
    select
      date_trunc('month', p_selected_month)::date as selected_month_start,
      (date_trunc('month', p_selected_month)::date + interval '1 month')::date as next_month_start
  ),
  active_transactions as (
    select t.*
    from public.transactions t
    where t.user_id = (select auth.uid())
      and t.deleted_at is null
      and not (
        t.installment_group_id is not null
        and t.installment_completed_at is not null
        and t.date > current_date
      )
  ),
  invested as (
    select coalesce(sum(t.amount), 0)::numeric as amount
    from active_transactions t
    left join public.categories c
      on c.id = t.category_id
      and c.user_id = t.user_id
    cross join month_bounds b
    where t.date < b.next_month_start
      and (t.kind = 'saving' or c.group_type = 'savings')
  ),
  monthly_balances as (
    select
      date_trunc('month', t.date)::date as month,
      coalesce(sum(t.amount) filter (
        where t.kind = 'income' and t.entry_kind <> 'reimbursement'
      ), 0)::numeric as income,
      coalesce(sum(
        case
          when t.kind = 'expense'
            and coalesce(t.entry_kind, 'purchase') not in ('repayment', 'transfer')
            and coalesce(c.group_type, '') <> 'savings'
            then t.amount
          when t.kind = 'income' and t.entry_kind = 'reimbursement'
            then -t.amount
          else 0
        end
      ), 0)::numeric as expenses,
      coalesce(sum(t.amount) filter (
        where t.kind = 'saving' or c.group_type = 'savings'
      ), 0)::numeric as savings
    from active_transactions t
    left join public.categories c
      on c.id = t.category_id and c.user_id = t.user_id
    cross join month_bounds b
    where t.date < b.next_month_start
    group by date_trunc('month', t.date)::date
  ),
  closed_month_balance as (
    select coalesce(sum(
      case
        when income - expenses < 0 then income - expenses
        else greatest(income - expenses - savings, 0)
      end
    ), 0)::numeric as amount
    from monthly_balances
    cross join month_bounds b
    where month < b.selected_month_start
  ),
  selected_month_deficit as (
    select least(coalesce(income - expenses, 0), 0)::numeric as amount
    from month_bounds b
    left join monthly_balances mb on mb.month = b.selected_month_start
  )
  select (invested.amount + closed_month_balance.amount + selected_month_deficit.amount)::numeric
  from invested
  cross join closed_month_balance
  cross join selected_month_deficit;
$$;

revoke all on function public.calculate_total_saved(date) from public;
grant execute on function public.calculate_total_saved(date) to authenticated;

commit;
