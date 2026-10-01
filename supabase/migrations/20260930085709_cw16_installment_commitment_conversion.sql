-- Safely replace an equivalent monthly reserve with an installment schedule.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.preview_installment_commitment_conversion(
  p_fixed_commitment_id uuid,
  p_installment_amount numeric,
  p_category_id uuid,
  p_payment_method_id uuid,
  p_current_occurrence_date date
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_commitment public.fixed_commitments%rowtype;
  v_blockers text[] := array[]::text[];
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  select commitment.*
  into v_commitment
  from public.fixed_commitments as commitment
  where commitment.id = p_fixed_commitment_id
    and commitment.user_id = v_user_id
    and commitment.deleted_at is null;

  if not found then
    v_blockers := array_append(v_blockers, 'not_found');
  else
    if not v_commitment.is_enabled then
      v_blockers := array_append(v_blockers, 'inactive');
    end if;
    if not v_commitment.include_in_safe_to_spend then
      v_blockers := array_append(v_blockers, 'not_reserved');
    end if;
    if v_commitment.cadence <> 'monthly' then
      v_blockers := array_append(v_blockers, 'cadence_mismatch');
    end if;
    if v_commitment.amount <> p_installment_amount then
      v_blockers := array_append(v_blockers, 'amount_mismatch');
    end if;
    if v_commitment.category_id is distinct from p_category_id then
      v_blockers := array_append(v_blockers, 'category_mismatch');
    end if;
    if v_commitment.payment_method_id is distinct from p_payment_method_id then
      v_blockers := array_append(v_blockers, 'payment_method_mismatch');
    end if;
    if v_commitment.start_date > p_current_occurrence_date
      or (
        v_commitment.end_date is not null
        and v_commitment.end_date < p_current_occurrence_date
      ) then
      v_blockers := array_append(v_blockers, 'date_mismatch');
    end if;
  end if;

  return jsonb_build_object(
    'blockers', to_jsonb(v_blockers),
    'canConvert', cardinality(v_blockers) = 0,
    'fixedCommitmentId', p_fixed_commitment_id
  );
end;
$$;

create or replace function private.convert_linked_fixed_commitment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_preview jsonb;
begin
  if new.linked_fixed_commitment_id is null then
    return new;
  end if;

  if exists (
    select 1
    from public.installment_plans as plan
    where plan.user_id = new.user_id
      and plan.idempotency_key = new.idempotency_key
      and plan.linked_fixed_commitment_id = new.linked_fixed_commitment_id
  ) then
    return new;
  end if;

  perform 1
  from public.fixed_commitments as commitment
  where commitment.id = new.linked_fixed_commitment_id
    and commitment.user_id = new.user_id
  for update;

  v_preview := public.preview_installment_commitment_conversion(
    new.linked_fixed_commitment_id,
    new.installment_amount,
    new.category_id,
    new.payment_method_id,
    new.current_occurrence_date
  );
  if not coalesce((v_preview ->> 'canConvert')::boolean, false) then
    raise exception 'linked fixed commitment is not equivalent: %',
      v_preview -> 'blockers';
  end if;

  update public.fixed_commitments
  set is_enabled = false
  where id = new.linked_fixed_commitment_id
    and user_id = new.user_id
    and is_enabled;

  if not found then
    raise exception 'linked fixed commitment could not be disabled';
  end if;

  return new;
end;
$$;

drop trigger if exists installment_plans_convert_fixed_commitment
on public.installment_plans;
create trigger installment_plans_convert_fixed_commitment
before insert on public.installment_plans
for each row execute function private.convert_linked_fixed_commitment();

revoke all on function public.preview_installment_commitment_conversion(
  uuid, numeric, uuid, uuid, date
) from public;
revoke all on function public.preview_installment_commitment_conversion(
  uuid, numeric, uuid, uuid, date
) from anon;
grant execute on function public.preview_installment_commitment_conversion(
  uuid, numeric, uuid, uuid, date
) to authenticated;

commit;
