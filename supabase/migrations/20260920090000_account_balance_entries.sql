-- CatWallet account balances: additive opening/adjustment ledger.
-- Opening balances are intentionally not transactions and therefore never enter
-- income, expense, saving, budget, fun-money, or monthly-report calculations.

alter table public.payment_methods
  add column if not exists balance_tracking_enabled boolean not null default false;

alter table public.payment_methods
  drop constraint if exists payment_methods_type_check;

alter table public.payment_methods
  add constraint payment_methods_type_check check (
    type in ('pix', 'debit', 'credit', 'cash', 'bank', 'boleto', 'other', 'ewallet')
  );

create table if not exists public.account_balance_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  payment_method_id uuid not null references public.payment_methods (id) on delete restrict,
  entry_type text not null check (entry_type in ('opening_balance', 'adjustment')),
  amount numeric(18, 2) not null,
  effective_date date not null,
  note text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_balance_entries_amount_scale_check
    check (amount = round(amount, 2)),
  constraint account_balance_entries_amount_semantics_check
    check (
      (entry_type = 'opening_balance' and amount >= 0)
      or (entry_type = 'adjustment' and amount <> 0)
    ),
  constraint account_balance_entries_note_length_check
    check (note is null or char_length(note) <= 500),
  constraint account_balance_entries_idempotency_key_length_check
    check (idempotency_key is null or char_length(idempotency_key) between 1 and 160)
);

alter table public.account_balance_entries enable row level security;
alter table public.account_balance_entries force row level security;

drop trigger if exists account_balance_entries_touch_updated_at
on public.account_balance_entries;
create trigger account_balance_entries_touch_updated_at
before update on public.account_balance_entries
for each row execute function private.touch_updated_at();

create index if not exists account_balance_entries_account_date_idx
  on public.account_balance_entries (user_id, payment_method_id, effective_date);

create unique index if not exists account_balance_entries_one_opening_idx
  on public.account_balance_entries (user_id, payment_method_id)
  where entry_type = 'opening_balance';

create unique index if not exists account_balance_entries_idempotency_idx
  on public.account_balance_entries (user_id, idempotency_key)
  where idempotency_key is not null;

revoke all on public.account_balance_entries from anon;
grant select, insert, update, delete on public.account_balance_entries to authenticated;

drop policy if exists "Users can select own account balance entries"
on public.account_balance_entries;
create policy "Users can select own account balance entries"
on public.account_balance_entries for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own account balance entries"
on public.account_balance_entries;
create policy "Users can insert own account balance entries"
on public.account_balance_entries for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.payment_methods
    where payment_methods.id = account_balance_entries.payment_method_id
      and payment_methods.user_id = (select auth.uid())
  )
);

drop policy if exists "Users can update own account balance entries"
on public.account_balance_entries;
create policy "Users can update own account balance entries"
on public.account_balance_entries for update
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.payment_methods
    where payment_methods.id = account_balance_entries.payment_method_id
      and payment_methods.user_id = (select auth.uid())
  )
);

drop policy if exists "Users can delete own account balance entries"
on public.account_balance_entries;
create policy "Users can delete own account balance entries"
on public.account_balance_entries for delete
to authenticated
using ((select auth.uid()) = user_id);
