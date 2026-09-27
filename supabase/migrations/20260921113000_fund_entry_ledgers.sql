-- Immutable movement history for CatWallet goals and sinking funds.
-- Current totals remain on the existing rows for backwards-compatible reads;
-- every new fund action is applied atomically by the invoker-owned RPC.

create table if not exists public.sinking_fund_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sinking_fund_id uuid not null references public.sinking_funds(id) on delete cascade,
  amount numeric(18, 2) not null check (amount <> 0 and amount = round(amount, 2)),
  entry_type text not null check (entry_type in ('contribution', 'withdrawal', 'adjustment')),
  note text,
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint sinking_fund_entries_key_length check (char_length(idempotency_key) between 1 and 200),
  constraint sinking_fund_entries_note_length check (note is null or char_length(note) <= 500),
  unique (user_id, idempotency_key)
);

create table if not exists public.goal_fund_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  amount numeric(18, 2) not null check (amount <> 0 and amount = round(amount, 2)),
  entry_type text not null check (entry_type in ('contribution', 'withdrawal', 'adjustment')),
  note text,
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint goal_fund_entries_key_length check (char_length(idempotency_key) between 1 and 200),
  constraint goal_fund_entries_note_length check (note is null or char_length(note) <= 500),
  unique (user_id, idempotency_key)
);

alter table public.sinking_fund_entries enable row level security;
alter table public.sinking_fund_entries force row level security;
alter table public.goal_fund_entries enable row level security;
alter table public.goal_fund_entries force row level security;

create index if not exists sinking_fund_entries_owner_fund_created_idx
  on public.sinking_fund_entries (user_id, sinking_fund_id, created_at desc);
create index if not exists goal_fund_entries_owner_goal_created_idx
  on public.goal_fund_entries (user_id, goal_id, created_at desc);

revoke all on public.sinking_fund_entries from public;
revoke all on public.sinking_fund_entries from anon;
revoke all on public.sinking_fund_entries from authenticated;
revoke all on public.goal_fund_entries from public;
revoke all on public.goal_fund_entries from anon;
revoke all on public.goal_fund_entries from authenticated;
grant select, insert on public.sinking_fund_entries to authenticated;
grant select, insert on public.goal_fund_entries to authenticated;

create policy "Users can select own sinking fund entries"
  on public.sinking_fund_entries for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can insert own sinking fund entries"
  on public.sinking_fund_entries for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.sinking_funds
      where sinking_funds.id = sinking_fund_entries.sinking_fund_id
        and sinking_funds.user_id = (select auth.uid())
        and sinking_funds.deleted_at is null
    )
  );

create policy "Users can select own goal fund entries"
  on public.goal_fund_entries for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can insert own goal fund entries"
  on public.goal_fund_entries for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.goals
      where goals.id = goal_fund_entries.goal_id
        and goals.user_id = (select auth.uid())
        and goals.deleted_at is null
    )
  );

create or replace function public.record_sinking_fund_entry(
  p_sinking_fund_id uuid,
  p_amount numeric,
  p_entry_type text,
  p_note text,
  p_idempotency_key text
)
returns numeric
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := (select auth.uid());
  current_value numeric;
  existing_amount numeric;
  existing_entry_type text;
  existing_note text;
  existing_sinking_fund_id uuid;
begin
  if caller_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if p_amount = 0 or p_amount <> round(p_amount, 2) then raise exception 'Amount is invalid.' using errcode = '22023'; end if;
  if p_entry_type not in ('contribution', 'withdrawal', 'adjustment') then raise exception 'Entry type is invalid.' using errcode = '22023'; end if;
  select current_amount into current_value from public.sinking_funds
    where id = p_sinking_fund_id and user_id = caller_id and deleted_at is null for update;
  if current_value is null then raise exception 'Sinking fund not found.' using errcode = 'P0002'; end if;
  if p_entry_type = 'contribution' and p_amount < 0 then raise exception 'Contribution amount is invalid.' using errcode = '22023'; end if;
  if p_entry_type = 'withdrawal' and p_amount > 0 then raise exception 'Withdrawal amount is invalid.' using errcode = '22023'; end if;
  if p_entry_type = 'withdrawal' and current_value + p_amount < 0 then
    raise exception 'Insufficient sinking fund balance.' using errcode = 'P0001';
  end if;

  begin
    insert into public.sinking_fund_entries(user_id, sinking_fund_id, amount, entry_type, note, idempotency_key)
      values (caller_id, p_sinking_fund_id, p_amount, p_entry_type, nullif(trim(p_note), ''), p_idempotency_key);
  exception when unique_violation then
    select amount, entry_type, note, sinking_fund_id
      into existing_amount, existing_entry_type, existing_note, existing_sinking_fund_id
      from public.sinking_fund_entries
      where user_id = caller_id and idempotency_key = p_idempotency_key;
    if existing_sinking_fund_id is distinct from p_sinking_fund_id
      or existing_amount is distinct from p_amount
      or existing_entry_type is distinct from p_entry_type
      or existing_note is distinct from nullif(trim(p_note), '') then
      raise exception 'Idempotency key conflicts with another fund entry.' using errcode = '23505';
    end if;
    return current_value;
  end;

  update public.sinking_funds set current_amount = current_value + p_amount where id = p_sinking_fund_id and user_id = caller_id;
  return current_value + p_amount;
end;
$$;

create or replace function public.record_goal_fund_entry(
  p_goal_id uuid,
  p_amount numeric,
  p_entry_type text,
  p_note text,
  p_idempotency_key text
)
returns numeric
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := (select auth.uid());
  current_value numeric;
  existing_amount numeric;
  existing_entry_type text;
  existing_note text;
  existing_goal_id uuid;
begin
  if caller_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if p_amount = 0 or p_amount <> round(p_amount, 2) then raise exception 'Amount is invalid.' using errcode = '22023'; end if;
  if p_entry_type not in ('contribution', 'withdrawal', 'adjustment') then raise exception 'Entry type is invalid.' using errcode = '22023'; end if;
  select current_amount into current_value from public.goals
    where id = p_goal_id and user_id = caller_id and deleted_at is null for update;
  if current_value is null then raise exception 'Goal not found.' using errcode = 'P0002'; end if;
  if p_entry_type = 'contribution' and p_amount < 0 then raise exception 'Contribution amount is invalid.' using errcode = '22023'; end if;
  if p_entry_type = 'withdrawal' and p_amount > 0 then raise exception 'Withdrawal amount is invalid.' using errcode = '22023'; end if;
  if p_entry_type = 'withdrawal' and current_value + p_amount < 0 then
    raise exception 'Insufficient goal balance.' using errcode = 'P0001';
  end if;

  begin
    insert into public.goal_fund_entries(user_id, goal_id, amount, entry_type, note, idempotency_key)
      values (caller_id, p_goal_id, p_amount, p_entry_type, nullif(trim(p_note), ''), p_idempotency_key);
  exception when unique_violation then
    select amount, entry_type, note, goal_id
      into existing_amount, existing_entry_type, existing_note, existing_goal_id
      from public.goal_fund_entries
      where user_id = caller_id and idempotency_key = p_idempotency_key;
    if existing_goal_id is distinct from p_goal_id
      or existing_amount is distinct from p_amount
      or existing_entry_type is distinct from p_entry_type
      or existing_note is distinct from nullif(trim(p_note), '') then
      raise exception 'Idempotency key conflicts with another fund entry.' using errcode = '23505';
    end if;
    return current_value;
  end;

  update public.goals set current_amount = current_value + p_amount where id = p_goal_id and user_id = caller_id;
  return current_value + p_amount;
end;
$$;

revoke execute on function public.record_sinking_fund_entry(uuid, numeric, text, text, text) from public;
revoke execute on function public.record_sinking_fund_entry(uuid, numeric, text, text, text) from anon;
grant execute on function public.record_sinking_fund_entry(uuid, numeric, text, text, text) to authenticated;
revoke execute on function public.record_goal_fund_entry(uuid, numeric, text, text, text) from public;
revoke execute on function public.record_goal_fund_entry(uuid, numeric, text, text, text) from anon;
grant execute on function public.record_goal_fund_entry(uuid, numeric, text, text, text) to authenticated;
