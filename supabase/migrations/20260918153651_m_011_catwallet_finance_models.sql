-- CatWallet stage 3-5 finance models.
-- These tables are additive and retain the original upstream tables and RLS model.

alter table public.transactions
  add column if not exists fixed_commitment_id uuid;

create table if not exists public.fixed_commitments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  amount numeric not null check (amount > 0),
  cadence text not null check (cadence in ('monthly', 'yearly', 'custom')),
  custom_interval_months smallint,
  start_date date not null,
  end_date date,
  payment_method_id uuid references public.payment_methods(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  include_in_safe_to_spend boolean not null default true,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint fixed_commitments_custom_interval_check check (
    (cadence = 'custom' and custom_interval_months between 1 and 120)
    or (cadence <> 'custom' and custom_interval_months is null)
  ),
  constraint fixed_commitments_date_range_check check (
    end_date is null or end_date >= start_date
  )
);

create table if not exists public.sinking_funds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  emoji text not null default '🛟' check (char_length(emoji) between 1 and 16),
  current_amount numeric not null default 0 check (current_amount >= 0),
  monthly_target numeric not null default 0 check (monthly_target >= 0),
  target_amount numeric check (target_amount is null or target_amount > 0),
  expected_use_date date,
  is_enabled boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.installment_retirement_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  installment_group_id uuid not null,
  target_type text not null check (target_type in ('category', 'sinking_fund', 'savings')),
  target_id uuid,
  monthly_amount numeric not null check (monthly_amount > 0),
  starts_month date not null,
  is_enabled boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint installment_retirement_target_check check (
    (target_type = 'savings' and target_id is null)
    or (target_type in ('category', 'sinking_fund') and target_id is not null)
  )
);

create unique index if not exists installment_retirement_allocations_target_idx
  on public.installment_retirement_allocations (user_id, installment_group_id, target_type, target_id)
  where target_type <> 'savings';

create unique index if not exists installment_retirement_allocations_savings_idx
  on public.installment_retirement_allocations (user_id, installment_group_id)
  where target_type = 'savings';

alter table public.transactions
  add constraint transactions_fixed_commitment_fk
  foreign key (fixed_commitment_id)
  references public.fixed_commitments(id)
  on delete set null;

alter table public.fixed_commitments enable row level security;
alter table public.fixed_commitments force row level security;
alter table public.sinking_funds enable row level security;
alter table public.sinking_funds force row level security;
alter table public.installment_retirement_allocations enable row level security;
alter table public.installment_retirement_allocations force row level security;

create policy "Users can select own fixed commitments"
on public.fixed_commitments for select to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy "Users can insert own fixed commitments"
on public.fixed_commitments for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "Users can update own fixed commitments"
on public.fixed_commitments for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Users can delete own fixed commitments"
on public.fixed_commitments for delete to authenticated
using (user_id = (select auth.uid()));

create policy "Users can select own sinking funds"
on public.sinking_funds for select to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy "Users can insert own sinking funds"
on public.sinking_funds for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "Users can update own sinking funds"
on public.sinking_funds for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Users can delete own sinking funds"
on public.sinking_funds for delete to authenticated
using (user_id = (select auth.uid()));

create policy "Users can select own installment retirement allocations"
on public.installment_retirement_allocations for select to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy "Users can insert own installment retirement allocations"
on public.installment_retirement_allocations for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "Users can update own installment retirement allocations"
on public.installment_retirement_allocations for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Users can delete own installment retirement allocations"
on public.installment_retirement_allocations for delete to authenticated
using (user_id = (select auth.uid()));

create or replace function private.touch_catwallet_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists fixed_commitments_touch_updated_at on public.fixed_commitments;
create trigger fixed_commitments_touch_updated_at
before update on public.fixed_commitments
for each row execute function private.touch_catwallet_updated_at();

drop trigger if exists sinking_funds_touch_updated_at on public.sinking_funds;
create trigger sinking_funds_touch_updated_at
before update on public.sinking_funds
for each row execute function private.touch_catwallet_updated_at();

drop trigger if exists installment_retirement_allocations_touch_updated_at
on public.installment_retirement_allocations;
create trigger installment_retirement_allocations_touch_updated_at
before update on public.installment_retirement_allocations
for each row execute function private.touch_catwallet_updated_at();

create or replace function private.validate_catwallet_owner_refs()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'transactions' then
    if new.fixed_commitment_id is not null and not exists (
      select 1 from public.fixed_commitments
      where id = new.fixed_commitment_id and user_id = new.user_id
    ) then
      raise exception 'invalid fixed commitment for transaction owner';
    end if;
  elsif tg_table_name = 'fixed_commitments' then
    if new.category_id is not null and not exists (
      select 1 from public.categories where id = new.category_id and user_id = new.user_id
    ) then
      raise exception 'invalid category for fixed commitment owner';
    end if;
    if new.payment_method_id is not null and not exists (
      select 1 from public.payment_methods where id = new.payment_method_id and user_id = new.user_id
    ) then
      raise exception 'invalid payment method for fixed commitment owner';
    end if;
  elsif tg_table_name = 'installment_retirement_allocations' then
    if new.target_type = 'category' and not exists (
      select 1 from public.categories where id = new.target_id and user_id = new.user_id
    ) then
      raise exception 'invalid category for installment allocation owner';
    end if;

    if new.target_type = 'sinking_fund' and not exists (
      select 1 from public.sinking_funds where id = new.target_id and user_id = new.user_id
    ) then
      raise exception 'invalid sinking fund for installment allocation owner';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists transactions_validate_catwallet_owner_refs on public.transactions;
create trigger transactions_validate_catwallet_owner_refs
before insert or update of user_id, fixed_commitment_id on public.transactions
for each row execute function private.validate_catwallet_owner_refs();

drop trigger if exists fixed_commitments_validate_owner_refs on public.fixed_commitments;
create trigger fixed_commitments_validate_owner_refs
before insert or update of user_id, category_id, payment_method_id
on public.fixed_commitments
for each row execute function private.validate_catwallet_owner_refs();

drop trigger if exists installment_retirement_allocations_validate_owner_refs
on public.installment_retirement_allocations;
create trigger installment_retirement_allocations_validate_owner_refs
before insert or update of user_id, target_type, target_id
on public.installment_retirement_allocations
for each row execute function private.validate_catwallet_owner_refs();

create index if not exists fixed_commitments_user_enabled_idx
on public.fixed_commitments (user_id, is_enabled, start_date);

create index if not exists sinking_funds_user_enabled_idx
on public.sinking_funds (user_id, is_enabled, expected_use_date);

create index if not exists transactions_fixed_commitment_idx
on public.transactions (user_id, fixed_commitment_id, date);

create index if not exists installment_retirement_allocations_user_group_idx
on public.installment_retirement_allocations (user_id, installment_group_id);

revoke all on
  public.fixed_commitments,
  public.sinking_funds,
  public.installment_retirement_allocations
from anon;

grant select, insert, update, delete on
  public.fixed_commitments,
  public.sinking_funds,
  public.installment_retirement_allocations
to authenticated;
;
