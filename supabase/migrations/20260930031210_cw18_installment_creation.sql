-- Create an in-progress installment plan atomically without fabricating paid history.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.installment_plans
  add column request_fingerprint text not null
  check (char_length(request_fingerprint) = 64);

create or replace function public.create_installment_plan(
  p_plan_id uuid,
  p_transaction_id uuid,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_description text,
  p_notes text,
  p_amount_mode text,
  p_entered_amount numeric,
  p_installment_amount numeric,
  p_total_amount numeric,
  p_current_installment integer,
  p_total_installments integer,
  p_current_occurrence_date date,
  p_payment_method_id uuid,
  p_category_id uuid,
  p_linked_fixed_commitment_id uuid,
  p_counts_toward_fun_money boolean,
  p_create_transaction boolean,
  p_occurrences jsonb
)
returns table (
  created_transaction_id uuid,
  created_plan_id uuid,
  replayed boolean
)
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan_id uuid;
  v_existing_fingerprint text;
  v_existing_transaction_id uuid;
  v_occurrence_count integer;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_current_installment < 1
    or p_current_installment > p_total_installments
    or p_total_installments < 2
    or p_total_installments > 120 then
    raise exception 'invalid installment progress';
  end if;

  if char_length(p_request_fingerprint) <> 64
    or p_entered_amount <= 0
    or p_installment_amount <= 0
    or p_total_amount <= 0 then
    raise exception 'invalid installment amounts or fingerprint';
  end if;

  if (
    p_amount_mode = 'per_installment'
    and (
      p_installment_amount <> p_entered_amount
      or p_total_amount <> p_entered_amount * p_total_installments
    )
  ) or (
    p_amount_mode = 'total'
    and (
      p_total_amount <> p_entered_amount
      or p_installment_amount
        <> floor(p_entered_amount * 100 / p_total_installments) / 100
    )
  ) then
    raise exception 'installment amount summary is inconsistent';
  end if;

  if jsonb_typeof(p_occurrences) <> 'array' then
    raise exception 'installment occurrences must be an array';
  end if;

  v_occurrence_count := jsonb_array_length(p_occurrences);
  if v_occurrence_count <> p_total_installments - p_current_installment + 1 then
    raise exception 'installment occurrence count does not match active schedule';
  end if;

  insert into public.installment_plans (
    id, user_id, description, amount_mode, entered_amount,
    installment_amount, total_amount, current_installment,
    total_installments, current_occurrence_date, payment_method_id,
    category_id, linked_fixed_commitment_id, idempotency_key,
    request_fingerprint
  ) values (
    p_plan_id, v_user_id, p_description, p_amount_mode, p_entered_amount,
    p_installment_amount, p_total_amount, p_current_installment,
    p_total_installments, p_current_occurrence_date, p_payment_method_id,
    p_category_id, p_linked_fixed_commitment_id, p_idempotency_key,
    p_request_fingerprint
  )
  on conflict (user_id, idempotency_key) do nothing
  returning id into v_plan_id;

  if v_plan_id is null then
    select plan.id, plan.request_fingerprint, occurrence.transaction_id
    into v_plan_id, v_existing_fingerprint, v_existing_transaction_id
    from public.installment_plans as plan
    join public.installment_occurrences as occurrence
      on occurrence.plan_id = plan.id
      and occurrence.installment_number = plan.current_installment
      and occurrence.deleted_at is null
    where plan.user_id = v_user_id
      and plan.idempotency_key = p_idempotency_key
      and plan.deleted_at is null;

    if v_plan_id is null or v_existing_transaction_id is null then
      raise exception 'existing installment request is incomplete';
    end if;
    if v_existing_fingerprint <> p_request_fingerprint then
      raise exception 'idempotency key was already used for a different request';
    end if;

    return query select v_existing_transaction_id, v_plan_id, true;
    return;
  end if;

  if p_create_transaction then
    insert into public.transactions (
      id, user_id, date, description, amount, kind, category_id,
      payment_method_id, notes, fixed_commitment_id,
      counts_toward_fun_money, installment_group_id,
      installment_number, installment_total, installment_amount,
      installment_amount_mode, installment_current_number,
      entry_kind, entry_idempotency_key
    ) values (
      p_transaction_id, v_user_id, p_current_occurrence_date,
      p_description, (p_occurrences -> 0 ->> 'amount')::numeric,
      'expense', p_category_id,
      p_payment_method_id, p_notes, p_linked_fixed_commitment_id,
      p_counts_toward_fun_money, v_plan_id, p_current_installment,
      p_total_installments, p_entered_amount, p_amount_mode,
      p_current_installment, 'purchase', p_idempotency_key
    );
  else
    select transaction.id
    into v_existing_transaction_id
    from public.transactions as transaction
    where transaction.id = p_transaction_id
      and transaction.user_id = v_user_id
      and transaction.deleted_at is null
      and transaction.kind = 'expense'
      and transaction.entry_kind = 'purchase'
      and transaction.date = p_current_occurrence_date
      and transaction.amount = (p_occurrences -> 0 ->> 'amount')::numeric
      and transaction.category_id = p_category_id
      and transaction.payment_method_id = p_payment_method_id
      and transaction.installment_group_id is null
    for update;

    if v_existing_transaction_id is null then
      raise exception 'existing current installment transaction is not eligible';
    end if;

    update public.transactions
    set installment_group_id = v_plan_id,
        installment_number = p_current_installment,
        installment_total = p_total_installments,
        installment_amount = p_entered_amount,
        installment_amount_mode = p_amount_mode,
        installment_current_number = p_current_installment
    where id = v_existing_transaction_id and user_id = v_user_id;
  end if;

  insert into public.installment_occurrences (
    id, user_id, plan_id, installment_number, amount, due_date,
    status, transaction_id
  )
  select
    (occurrence.value ->> 'id')::uuid,
    v_user_id,
    v_plan_id,
    (occurrence.value ->> 'installmentNumber')::smallint,
    (occurrence.value ->> 'amount')::numeric,
    (occurrence.value ->> 'dueDate')::date,
    occurrence.value ->> 'status',
    case
      when occurrence.value ->> 'status' = 'posted' then p_transaction_id
      else null
    end
  from jsonb_array_elements(p_occurrences) with ordinality as occurrence(value, position)
  where (occurrence.value ->> 'installmentNumber')::integer
          = p_current_installment + occurrence.position::integer - 1
    and (occurrence.value ->> 'dueDate')::date
          = (p_current_occurrence_date
            + make_interval(months => occurrence.position::integer - 1))::date
    and (occurrence.value ->> 'amount')::numeric = case
      when p_amount_mode = 'per_installment' then p_entered_amount
      when (occurrence.value ->> 'installmentNumber')::integer
        < p_total_installments
        then floor(p_entered_amount * 100 / p_total_installments) / 100
      else p_entered_amount
        - (floor(p_entered_amount * 100 / p_total_installments) / 100)
          * (p_total_installments - 1)
    end
    and (
      (occurrence.position = 1 and occurrence.value ->> 'status' = 'posted')
      or (occurrence.position > 1 and occurrence.value ->> 'status' = 'planned')
    );

  if not found or (
    select count(*)
    from public.installment_occurrences
    where plan_id = v_plan_id
  ) <> v_occurrence_count then
    raise exception 'invalid active installment occurrence sequence';
  end if;

  return query select p_transaction_id, v_plan_id, false;
end;
$$;

revoke all on function public.create_installment_plan(
  uuid, uuid, text, text, text, text, text, numeric, numeric, numeric,
  integer, integer, date, uuid, uuid, uuid, boolean, boolean, jsonb
) from public;
revoke all on function public.create_installment_plan(
  uuid, uuid, text, text, text, text, text, numeric, numeric, numeric,
  integer, integer, date, uuid, uuid, uuid, boolean, boolean, jsonb
) from anon;
grant execute on function public.create_installment_plan(
  uuid, uuid, text, text, text, text, text, numeric, numeric, numeric,
  integer, integer, date, uuid, uuid, uuid, boolean, boolean, jsonb
) to authenticated;

commit;
