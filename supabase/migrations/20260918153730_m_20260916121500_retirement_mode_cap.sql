-- Per-installment plans release the entered amount, not the final rounded row.
create or replace function public.save_installment_retirement_allocations(
  p_group_id uuid, p_starts_month date, p_allocations jsonb
) returns setof public.installment_retirement_allocations
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_release numeric;
  v_end date;
  v_total numeric;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || p_group_id::text, 0));
  select case
    when installment_amount_mode = 'per_installment' then installment_amount
    else amount
  end, date
  into v_release, v_end
  from public.transactions
  where user_id = v_user and installment_group_id = p_group_id
  order by date desc, installment_number desc limit 1;
  if not found then raise exception 'installment group not owned'; end if;
  if p_starts_month is null or extract(day from p_starts_month) <> 1
    or p_starts_month < (date_trunc('month', v_end) + interval '1 month')::date then
    raise exception 'invalid retirement start month';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'invalid allocation list';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_allocations)
    as a(target_type text, target_id uuid, monthly_amount numeric)
    where monthly_amount is null or monthly_amount <= 0
      or monthly_amount::text in ('NaN', 'Infinity', '-Infinity')
      or monthly_amount <> round(monthly_amount, 2)
      or target_type is null or target_type not in ('savings', 'category', 'sinking_fund')
      or (target_type = 'savings' and target_id is not null)
      or (target_type <> 'savings' and target_id is null)) then
    raise exception 'invalid allocation';
  end if;
  select coalesce(sum(monthly_amount), 0) into v_total
    from jsonb_to_recordset(p_allocations) as a(monthly_amount numeric);
  if v_total > v_release then raise exception 'allocation exceeds monthly release'; end if;
  delete from public.installment_retirement_allocations
    where user_id = v_user and installment_group_id = p_group_id;
  return query insert into public.installment_retirement_allocations
    (user_id, installment_group_id, starts_month, target_type, target_id, monthly_amount)
    select v_user, p_group_id, p_starts_month, target_type, target_id, monthly_amount
    from jsonb_to_recordset(p_allocations)
      as a(target_type text, target_id uuid, monthly_amount numeric)
    returning *;
end;
$$;
revoke all on function public.save_installment_retirement_allocations(uuid, date, jsonb) from public, anon;
grant execute on function public.save_installment_retirement_allocations(uuid, date, jsonb) to authenticated;
;
