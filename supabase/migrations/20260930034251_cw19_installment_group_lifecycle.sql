-- Manage an installment plan and its occurrences as one soft-deleted group.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.preview_delete_installment(p_plan_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan public.installment_plans%rowtype;
  v_blockers jsonb := '[]'::jsonb;
  v_occurrence_count integer;
begin
  select * into v_plan
  from public.installment_plans
  where id = p_plan_id and user_id = v_user_id and deleted_at is null;
  if not found then raise exception 'installment plan not found'; end if;

  if v_plan.status <> 'completed' then
    v_blockers := v_blockers || jsonb_build_array('active_plan');
  end if;
  if exists (
    select 1 from public.installment_occurrences
    where plan_id = p_plan_id and user_id = v_user_id
      and deleted_at is null and external_reference is not null
  ) then
    v_blockers := v_blockers || jsonb_build_array('external_reference');
  end if;
  if exists (
    select 1 from public.installment_retirement_allocations
    where installment_group_id = p_plan_id and user_id = v_user_id
  ) then
    v_blockers := v_blockers || jsonb_build_array('retirement_allocation');
  end if;
  if exists (
    select 1
    from public.installment_occurrences as occurrence
    join public.transactions as transaction on transaction.id = occurrence.transaction_id
    where occurrence.plan_id = p_plan_id and occurrence.user_id = v_user_id
      and transaction.related_invoice_id is not null
  ) then
    v_blockers := v_blockers || jsonb_build_array('payment_allocation');
  end if;

  select count(*) into v_occurrence_count
  from public.installment_occurrences
  where plan_id = p_plan_id and user_id = v_user_id and deleted_at is null;

  return jsonb_build_object(
    'planId', p_plan_id,
    'occurrenceCount', v_occurrence_count,
    'canDelete', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers
  );
end;
$$;

create or replace function public.delete_installment(p_plan_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_preview jsonb;
begin
  perform 1 from public.installment_plans
  where id = p_plan_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    if exists (
      select 1 from public.installment_plans
      where id = p_plan_id and user_id = v_user_id and deleted_at is not null
    ) then return p_plan_id;
    end if;
    raise exception 'installment plan not found';
  end if;

  v_preview := public.preview_delete_installment(p_plan_id);
  if not (v_preview ->> 'canDelete')::boolean then
    raise exception 'installment plan cannot be deleted: %', v_preview -> 'blockers';
  end if;

  update public.installment_occurrences
  set deleted_at = now()
  where plan_id = p_plan_id and user_id = v_user_id and deleted_at is null;
  update public.installment_plans
  set deleted_at = now()
  where id = p_plan_id and user_id = v_user_id and deleted_at is null;
  return p_plan_id;
end;
$$;

create or replace function public.restore_installment(p_plan_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan public.installment_plans%rowtype;
begin
  select * into v_plan
  from public.installment_plans
  where id = p_plan_id and user_id = v_user_id
  for update;
  if not found then raise exception 'installment plan not found'; end if;
  if v_plan.deleted_at is null then return p_plan_id; end if;

  if not exists (
    select 1 from public.payment_methods
    where id = v_plan.payment_method_id and user_id = v_user_id and deleted_at is null
  ) then raise exception 'installment payment method is unavailable'; end if;
  if not exists (
    select 1 from public.categories
    where id = v_plan.category_id and user_id = v_user_id and deleted_at is null
  ) then raise exception 'installment category is unavailable'; end if;
  if exists (
    select 1 from public.installment_occurrences
    where plan_id = p_plan_id and user_id = v_user_id
      and external_reference is not null
  ) then raise exception 'installment has an external reference conflict'; end if;

  update public.installment_occurrences
  set deleted_at = null
  where plan_id = p_plan_id and user_id = v_user_id;
  update public.installment_plans
  set deleted_at = null
  where id = p_plan_id and user_id = v_user_id;
  return p_plan_id;
end;
$$;

create or replace function private.protect_installment_transaction_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_transaction public.transactions%rowtype;
begin
  v_transaction := case when tg_op = 'DELETE' then old else new end;
  if auth.uid() is null then return v_transaction; end if;
  if v_transaction.installment_group_id is not null and exists (
    select 1 from public.installment_plans
    where id = v_transaction.installment_group_id
      and user_id = v_transaction.user_id
  ) then
    raise exception 'use installment group lifecycle operations';
  end if;
  return v_transaction;
end;
$$;

create trigger transactions_protect_modeled_installment_delete
before delete or update of deleted_at on public.transactions
for each row execute function private.protect_installment_transaction_lifecycle();

revoke all on function public.preview_delete_installment(uuid) from public, anon;
revoke all on function public.delete_installment(uuid) from public, anon;
revoke all on function public.restore_installment(uuid) from public, anon;
grant execute on function public.preview_delete_installment(uuid) to authenticated;
grant execute on function public.delete_installment(uuid) to authenticated;
grant execute on function public.restore_installment(uuid) to authenticated;

commit;
