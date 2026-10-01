-- Model installment history as a plan baseline plus current/future occurrences.
-- Existing transaction-backed installment groups remain untouched and readable.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists public.installment_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  description text not null,
  amount_mode text not null check (amount_mode in ('per_installment', 'total')),
  entered_amount numeric not null check (entered_amount > 0),
  installment_amount numeric not null check (installment_amount > 0),
  total_amount numeric not null check (total_amount > 0),
  current_installment smallint not null check (current_installment >= 1),
  total_installments smallint not null check (total_installments between 2 and 120),
  current_occurrence_date date not null,
  original_purchase_date date,
  payment_method_id uuid not null references public.payment_methods(id) on delete restrict,
  category_id uuid not null references public.categories(id) on delete restrict,
  linked_fixed_commitment_id uuid references public.fixed_commitments(id) on delete set null,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  status text not null default 'active' check (status in ('active', 'completed')),
  version integer not null default 1 check (version >= 1),
  completed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint installment_plans_progress_check check (
    current_installment <= total_installments
  ),
  constraint installment_plans_completion_check check (
    (status = 'active' and completed_at is null)
    or (status = 'completed' and completed_at is not null)
  ),
  unique (user_id, id),
  unique (user_id, idempotency_key)
);

create table if not exists public.installment_occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_id uuid not null,
  installment_number smallint not null check (installment_number >= 1),
  amount numeric not null check (amount > 0),
  due_date date not null,
  status text not null check (status in ('planned', 'posted', 'settled')),
  transaction_id uuid references public.transactions(id) on delete restrict,
  external_reference text,
  settled_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint installment_occurrences_plan_owner_fk
    foreign key (user_id, plan_id)
    references public.installment_plans(user_id, id)
    on delete cascade,
  constraint installment_occurrences_transaction_state_check check (
    (status = 'planned' and transaction_id is null and settled_at is null)
    or (status = 'posted' and transaction_id is not null and settled_at is null)
    or (status = 'settled' and transaction_id is not null and settled_at is not null)
  ),
  unique (plan_id, installment_number),
  unique (transaction_id)
);

create index if not exists installment_plans_user_status_idx
  on public.installment_plans (user_id, status, current_occurrence_date)
  where deleted_at is null;

create index if not exists installment_occurrences_user_due_idx
  on public.installment_occurrences (user_id, due_date, status)
  where deleted_at is null;

create or replace function private.validate_installment_plan_refs()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  plan_current_installment smallint;
  plan_total_installments smallint;
begin
  if tg_table_name = 'installment_plans' then
    if not exists (
      select 1
      from public.payment_methods
      where id = new.payment_method_id and user_id = new.user_id
    ) then
      raise exception 'invalid payment method for installment plan owner';
    end if;

    if not exists (
      select 1
      from public.categories
      where id = new.category_id and user_id = new.user_id
    ) then
      raise exception 'invalid category for installment plan owner';
    end if;

    if new.linked_fixed_commitment_id is not null and not exists (
      select 1
      from public.fixed_commitments
      where id = new.linked_fixed_commitment_id and user_id = new.user_id
    ) then
      raise exception 'invalid fixed commitment for installment plan owner';
    end if;
  elsif tg_table_name = 'installment_occurrences' then
    select current_installment, total_installments
    into plan_current_installment, plan_total_installments
    from public.installment_plans
    where id = new.plan_id and user_id = new.user_id;

    if not found then
      raise exception 'installment plan not owned';
    end if;

    if new.installment_number < plan_current_installment then
      raise exception 'installment_number >= current_installment is required';
    end if;

    if new.installment_number > plan_total_installments then
      raise exception 'installment_number <= total_installments is required';
    end if;

    if new.transaction_id is not null and not exists (
      select 1
      from public.transactions
      where id = new.transaction_id and user_id = new.user_id
    ) then
      raise exception 'invalid transaction for installment occurrence owner';
    end if;
  end if;

  return new;
end;
$$;

create trigger installment_plans_validate_owner_refs
before insert or update of user_id, payment_method_id, category_id,
  linked_fixed_commitment_id
on public.installment_plans
for each row execute function private.validate_installment_plan_refs();

create trigger installment_occurrences_validate_owner_refs
before insert or update of user_id, plan_id, installment_number, transaction_id
on public.installment_occurrences
for each row execute function private.validate_installment_plan_refs();

create trigger installment_plans_touch_updated_at
before update on public.installment_plans
for each row execute function private.touch_catwallet_updated_at();

create trigger installment_occurrences_touch_updated_at
before update on public.installment_occurrences
for each row execute function private.touch_catwallet_updated_at();

alter table public.installment_plans enable row level security;
alter table public.installment_plans force row level security;
alter table public.installment_occurrences enable row level security;
alter table public.installment_occurrences force row level security;

create policy "Users can select own installment plans"
on public.installment_plans for select to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy "Users can insert own installment plans"
on public.installment_plans for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "Users can update own installment plans"
on public.installment_plans for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Users can select own installment occurrences"
on public.installment_occurrences for select to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy "Users can insert own installment occurrences"
on public.installment_occurrences for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "Users can update own installment occurrences"
on public.installment_occurrences for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

revoke all on public.installment_plans from public;
revoke all on public.installment_plans from anon;
revoke all on public.installment_plans from authenticated;
revoke all on public.installment_occurrences from public;
revoke all on public.installment_occurrences from anon;
revoke all on public.installment_occurrences from authenticated;

grant select, insert, update on public.installment_plans to authenticated;
grant select, insert, update on public.installment_occurrences to authenticated;

commit;
