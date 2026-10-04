-- Keep posted installment transactions in the same reversible lifecycle as
-- their plan and occurrences. Previously a deleted group could leave active
-- transaction rows behind in reports and account views.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.delete_installment(p_plan_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_preview jsonb;
  v_deleted_at timestamptz := clock_timestamp();
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
  set deleted_at = v_deleted_at
  where plan_id = p_plan_id and user_id = v_user_id and deleted_at is null;

  update public.installment_plans
  set deleted_at = v_deleted_at
  where id = p_plan_id and user_id = v_user_id and deleted_at is null;

  update public.transactions as transaction
  set deleted_at = v_deleted_at
  from public.installment_occurrences as occurrence
  where occurrence.plan_id = p_plan_id
    and occurrence.user_id = v_user_id
    and transaction.id = occurrence.transaction_id
    and transaction.user_id = v_user_id
    and transaction.deleted_at is null;

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

  update public.transactions as transaction
  set deleted_at = null
  from public.installment_occurrences as occurrence
  where occurrence.plan_id = p_plan_id
    and occurrence.user_id = v_user_id
    and occurrence.deleted_at = v_plan.deleted_at
    and transaction.id = occurrence.transaction_id
    and transaction.user_id = v_user_id
    and transaction.deleted_at = v_plan.deleted_at;

  update public.installment_occurrences
  set deleted_at = null
  where plan_id = p_plan_id
    and user_id = v_user_id
    and deleted_at = v_plan.deleted_at;

  update public.installment_plans
  set deleted_at = null
  where id = p_plan_id and user_id = v_user_id and deleted_at = v_plan.deleted_at;

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
      and deleted_at is null
  ) then
    raise exception 'use installment group lifecycle operations';
  end if;
  return v_transaction;
end;
$$;

revoke all on function public.delete_installment(uuid) from public, anon;
revoke all on function public.restore_installment(uuid) from public, anon;
grant execute on function public.delete_installment(uuid) to authenticated;
grant execute on function public.restore_installment(uuid) to authenticated;

commit;
