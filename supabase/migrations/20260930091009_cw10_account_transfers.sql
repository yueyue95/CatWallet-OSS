-- Atomic same-currency transfers between non-credit payment accounts.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.account_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_account_id uuid not null references public.payment_methods(id) on delete restrict,
  destination_account_id uuid not null references public.payment_methods(id) on delete restrict,
  amount numeric not null check (amount > 0),
  transfer_date date not null,
  description text not null,
  notes text,
  idempotency_key text not null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint account_transfers_distinct_accounts_check
    check (source_account_id <> destination_account_id),
  constraint account_transfers_owner_idempotency_unique
    unique (user_id, idempotency_key)
);

alter table public.transactions
  add column transfer_id uuid references public.account_transfers(id) on delete restrict;
alter table public.transactions
  add column transfer_side text check (transfer_side in ('out', 'in'));
alter table public.transactions
  add constraint transactions_transfer_shape_check
  check (
    (transfer_id is null and transfer_side is null)
    or (
      entry_kind = 'transfer'
      and transfer_id is not null
      and (
        (transfer_side = 'out' and kind = 'expense')
        or (transfer_side = 'in' and kind = 'income')
      )
    )
  );

create unique index transactions_transfer_side_idx
  on public.transactions (transfer_id, transfer_side)
  where transfer_id is not null;

create index account_transfers_user_date_idx
  on public.account_transfers (user_id, transfer_date desc);

create or replace function private.validate_account_transfer()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_source_type text;
  v_destination_type text;
begin
  select account.type
  into v_source_type
  from public.payment_methods as account
  where account.id = new.source_account_id
    and account.user_id = new.user_id
    and account.deleted_at is null;
  select account.type
  into v_destination_type
  from public.payment_methods as account
  where account.id = new.destination_account_id
    and account.user_id = new.user_id
    and account.deleted_at is null;

  if v_source_type is null or v_destination_type is null then
    raise exception 'transfer account does not belong to the current user';
  end if;
  if v_source_type = 'credit' or v_destination_type = 'credit' then
    raise exception 'credit accounts require card-payment semantics';
  end if;

  if tg_op = 'UPDATE' then
    if new.revision = old.revision then
      new.revision := old.revision + 1;
    elsif new.revision <> old.revision + 1 then
      raise exception 'transfer revision must advance exactly once';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger account_transfers_validate
before insert or update on public.account_transfers
for each row execute function private.validate_account_transfer();

create or replace function private.sync_account_transfer_ledger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.transactions (
    user_id, date, description, amount, kind, payment_method_id, notes,
    entry_kind, entry_idempotency_key, transfer_id, transfer_side, deleted_at
  ) values
  (
    new.user_id, new.transfer_date, new.description, new.amount, 'expense',
    new.source_account_id, new.notes, 'transfer', new.id::text || ':out',
    new.id, 'out', new.deleted_at
  ),
  (
    new.user_id, new.transfer_date, new.description, new.amount, 'income',
    new.destination_account_id, new.notes, 'transfer', new.id::text || ':in',
    new.id, 'in', new.deleted_at
  )
  on conflict (transfer_id, transfer_side) where transfer_id is not null
  do update set
    user_id = excluded.user_id,
    date = excluded.date,
    description = excluded.description,
    amount = excluded.amount,
    kind = excluded.kind,
    category_id = null,
    payment_method_id = excluded.payment_method_id,
    notes = excluded.notes,
    entry_kind = excluded.entry_kind,
    deleted_at = excluded.deleted_at;
  return new;
end;
$$;

create trigger account_transfers_sync_ledger
after insert or update on public.account_transfers
for each row execute function private.sync_account_transfer_ledger();

create or replace function private.validate_transfer_ledger_row()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_transfer public.account_transfers%rowtype;
begin
  if new.transfer_id is null then
    return new;
  end if;

  select transfer.*
  into v_transfer
  from public.account_transfers as transfer
  where transfer.id = new.transfer_id
    and transfer.user_id = new.user_id;
  if not found then
    raise exception 'invalid transfer for ledger owner';
  end if;

  if new.amount <> v_transfer.amount
    or new.date <> v_transfer.transfer_date
    or new.description <> v_transfer.description
    or new.notes is distinct from v_transfer.notes
    or new.deleted_at is distinct from v_transfer.deleted_at
    or new.entry_kind <> 'transfer'
    or new.category_id is not null
    or (
      new.transfer_side = 'out'
      and (
        new.kind <> 'expense'
        or new.payment_method_id <> v_transfer.source_account_id
      )
    )
    or (
      new.transfer_side = 'in'
      and (
        new.kind <> 'income'
        or new.payment_method_id <> v_transfer.destination_account_id
      )
    ) then
    raise exception 'transfer ledger rows must be changed through the transfer group';
  end if;
  return new;
end;
$$;

create trigger transactions_validate_transfer_ledger
before insert or update of
  user_id, amount, date, description, notes, deleted_at, entry_kind,
  category_id, payment_method_id, transfer_id, transfer_side, kind
on public.transactions
for each row execute function private.validate_transfer_ledger_row();

create or replace function private.prevent_transfer_physical_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return old;
  end if;
  raise exception 'account transfers use soft deletion';
end;
$$;

create trigger account_transfers_prevent_physical_delete
before delete on public.account_transfers
for each row execute function private.prevent_transfer_physical_delete();

create or replace function private.prevent_transfer_ledger_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.transfer_id is not null and auth.uid() is not null then
    raise exception 'transfer ledger rows must be changed through the transfer group';
  end if;
  return old;
end;
$$;

create trigger transactions_prevent_transfer_ledger_delete
before delete on public.transactions
for each row execute function private.prevent_transfer_ledger_delete();

alter table public.account_transfers enable row level security;
alter table public.account_transfers force row level security;

create policy "Users can select own account transfers"
on public.account_transfers for select to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));
create policy "Users can insert own account transfers"
on public.account_transfers for insert to authenticated
with check (user_id = (select auth.uid()));
create policy "Users can update own account transfers"
on public.account_transfers for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
create policy "Users can delete own account transfers"
on public.account_transfers for delete to authenticated
using (user_id = (select auth.uid()));

revoke all on public.account_transfers from public, anon;
grant select, insert, update, delete on public.account_transfers to authenticated;

create or replace function public.preview_account_transfer(
  p_transfer_id uuid,
  p_source_account_id uuid,
  p_destination_account_id uuid,
  p_amount numeric,
  p_transfer_date date,
  p_expected_revision integer
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_source_type text;
  v_destination_type text;
  v_current_revision integer;
  v_blockers text[] := array[]::text[];
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;
  select type into v_source_type from public.payment_methods
  where id = p_source_account_id and user_id = v_user_id and deleted_at is null;
  select type into v_destination_type from public.payment_methods
  where id = p_destination_account_id and user_id = v_user_id and deleted_at is null;
  if v_source_type is null then
    v_blockers := array_append(v_blockers, 'invalid_source_account');
  end if;
  if v_destination_type is null then
    v_blockers := array_append(v_blockers, 'invalid_destination_account');
  end if;
  if v_source_type = 'credit' or v_destination_type = 'credit' then
    v_blockers := array_append(v_blockers, 'credit_account');
  end if;
  if p_source_account_id = p_destination_account_id then
    v_blockers := array_append(v_blockers, 'same_account');
  end if;
  if p_amount is null or p_amount <= 0 then
    v_blockers := array_append(v_blockers, 'invalid_amount');
  end if;
  if p_transfer_id is not null then
    select revision into v_current_revision
    from public.account_transfers
    where id = p_transfer_id and user_id = v_user_id;
    if v_current_revision is null then
      v_blockers := array_append(v_blockers, 'not_found');
    elsif p_expected_revision is distinct from v_current_revision then
      v_blockers := array_append(v_blockers, 'revision_conflict');
    end if;
  end if;
  return jsonb_build_object(
    'blockers', to_jsonb(v_blockers),
    'canApply', cardinality(v_blockers) = 0,
    'currentRevision', v_current_revision,
    'transferDate', p_transfer_date,
    'transferId', p_transfer_id
  );
end;
$$;

create or replace function public.create_account_transfer(
  p_transfer_id uuid,
  p_idempotency_key text,
  p_source_account_id uuid,
  p_destination_account_id uuid,
  p_amount numeric,
  p_transfer_date date,
  p_description text,
  p_notes text
)
returns table (created_transfer_id uuid, current_revision integer, replayed boolean)
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_transfer public.account_transfers%rowtype;
  v_preview jsonb;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  v_preview := public.preview_account_transfer(
    null, p_source_account_id, p_destination_account_id,
    p_amount, p_transfer_date, null
  );
  if not (v_preview ->> 'canApply')::boolean then
    raise exception 'account transfer is invalid: %', v_preview -> 'blockers';
  end if;

  insert into public.account_transfers (
    id, user_id, source_account_id, destination_account_id, amount,
    transfer_date, description, notes, idempotency_key
  ) values (
    p_transfer_id, v_user_id, p_source_account_id, p_destination_account_id,
    p_amount, p_transfer_date, p_description, p_notes, p_idempotency_key
  ) on conflict do nothing
  returning * into v_transfer;

  if v_transfer.id is null then
    select * into v_transfer from public.account_transfers
    where user_id = v_user_id and idempotency_key = p_idempotency_key;
    if v_transfer.source_account_id <> p_source_account_id
      or v_transfer.destination_account_id <> p_destination_account_id
      or v_transfer.amount <> p_amount
      or v_transfer.transfer_date <> p_transfer_date then
      raise exception 'idempotency key was already used for a different transfer';
    end if;
    return query select v_transfer.id, v_transfer.revision, true;
    return;
  end if;
  return query select v_transfer.id, v_transfer.revision, false;
end;
$$;

create or replace function public.update_account_transfer(
  p_transfer_id uuid,
  p_expected_revision integer,
  p_source_account_id uuid,
  p_destination_account_id uuid,
  p_amount numeric,
  p_transfer_date date,
  p_description text,
  p_notes text
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_revision integer;
  v_preview jsonb;
begin
  v_preview := public.preview_account_transfer(
    p_transfer_id, p_source_account_id, p_destination_account_id,
    p_amount, p_transfer_date, p_expected_revision
  );
  if not (v_preview ->> 'canApply')::boolean then
    if v_preview -> 'blockers' ? 'revision_conflict' then
      raise exception 'transfer was modified by another request';
    end if;
    raise exception 'account transfer is invalid: %', v_preview -> 'blockers';
  end if;
  update public.account_transfers set
    source_account_id = p_source_account_id,
    destination_account_id = p_destination_account_id,
    amount = p_amount,
    transfer_date = p_transfer_date,
    description = p_description,
    notes = p_notes,
    revision = revision + 1
  where id = p_transfer_id
    and user_id = auth.uid()
    and revision = p_expected_revision
    and deleted_at is null
  returning revision into v_revision;
  if v_revision is null then
    raise exception 'transfer was modified by another request';
  end if;
  return v_revision;
end;
$$;

create or replace function public.delete_account_transfer(
  p_transfer_id uuid,
  p_expected_revision integer
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_transfer public.account_transfers%rowtype;
begin
  select * into v_transfer from public.account_transfers
  where id = p_transfer_id and user_id = auth.uid() for update;
  if v_transfer.id is null then raise exception 'account transfer was not found'; end if;
  if v_transfer.deleted_at is not null then return v_transfer.revision; end if;
  if v_transfer.revision <> p_expected_revision then
    raise exception 'transfer was modified by another request';
  end if;
  update public.account_transfers
  set deleted_at = now(), revision = revision + 1
  where id = p_transfer_id
  returning revision into v_transfer.revision;
  return v_transfer.revision;
end;
$$;

create or replace function public.restore_account_transfer(
  p_transfer_id uuid,
  p_expected_revision integer
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_transfer public.account_transfers%rowtype;
begin
  select * into v_transfer from public.account_transfers
  where id = p_transfer_id and user_id = auth.uid() for update;
  if v_transfer.id is null then raise exception 'account transfer was not found'; end if;
  if v_transfer.deleted_at is null then return v_transfer.revision; end if;
  if v_transfer.revision <> p_expected_revision then
    raise exception 'transfer was modified by another request';
  end if;
  update public.account_transfers
  set deleted_at = null, revision = revision + 1
  where id = p_transfer_id
  returning revision into v_transfer.revision;
  return v_transfer.revision;
end;
$$;

revoke all on function public.preview_account_transfer(uuid, uuid, uuid, numeric, date, integer) from public, anon;
revoke all on function public.create_account_transfer(uuid, text, uuid, uuid, numeric, date, text, text) from public, anon;
revoke all on function public.update_account_transfer(uuid, integer, uuid, uuid, numeric, date, text, text) from public, anon;
revoke all on function public.delete_account_transfer(uuid, integer) from public, anon;
revoke all on function public.restore_account_transfer(uuid, integer) from public, anon;
grant execute on function public.preview_account_transfer(uuid, uuid, uuid, numeric, date, integer) to authenticated;
grant execute on function public.create_account_transfer(uuid, text, uuid, uuid, numeric, date, text, text) to authenticated;
grant execute on function public.update_account_transfer(uuid, integer, uuid, uuid, numeric, date, text, text) to authenticated;
grant execute on function public.delete_account_transfer(uuid, integer) to authenticated;
grant execute on function public.restore_account_transfer(uuid, integer) to authenticated;

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
        where t.kind = 'income'
          and coalesce(t.entry_kind, 'purchase') not in ('reimbursement', 'transfer')
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
