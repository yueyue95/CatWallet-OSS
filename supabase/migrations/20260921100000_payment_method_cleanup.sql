-- Atomically remove an owned payment account only when it has no active
-- business references. Soft-deleted transactions and balance history are
-- disposable account-owned cleanup records.

create or replace function public.delete_payment_method_if_empty(
  p_payment_method_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then
    raise exception 'Payment method deletion requires authentication.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.payment_methods
    where id = p_payment_method_id
      and user_id = caller_id
      and deleted_at is null
  ) then
    raise exception 'Payment method not found.'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.transactions
    where payment_method_id = p_payment_method_id
      and user_id = caller_id
      and deleted_at is null
  ) then
    raise exception 'Payment method cannot be deleted because it has transactions.'
      using errcode = 'P0001', detail = 'active_transactions';
  end if;

  if exists (
    select 1
    from public.fixed_commitments
    where payment_method_id = p_payment_method_id
      and user_id = caller_id
      and deleted_at is null
  ) then
    raise exception 'Payment method cannot be deleted because it has fixed commitments.'
      using errcode = 'P0001', detail = 'active_fixed_commitments';
  end if;

  -- These deletes are covered by the caller's existing owner-scoped DELETE
  -- policies and run in the same transaction as the account delete.
  delete from public.transactions
  where payment_method_id = p_payment_method_id
    and user_id = caller_id
    and deleted_at is not null;

  delete from public.account_balance_entries
  where payment_method_id = p_payment_method_id
    and user_id = caller_id;

  delete from public.payment_methods
  where id = p_payment_method_id
    and user_id = caller_id;

  if not found then
    raise exception 'Payment method was changed before deletion completed.'
      using errcode = '40001';
  end if;

  return true;
end;
$$;

revoke execute on function public.delete_payment_method_if_empty(uuid) from public;
revoke execute on function public.delete_payment_method_if_empty(uuid) from anon;
grant execute on function public.delete_payment_method_if_empty(uuid) to authenticated;
