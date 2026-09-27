-- Persist the ownership and reversible impact of each Butler transaction import.
-- Existing transactions keep a null import_batch_id and are not rewritten.

begin;

create table if not exists public.transaction_import_batches (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  status text not null default 'active' check (status in ('active', 'undone', 'failed')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, idempotency_key)
);

alter table public.transactions
  add column if not exists import_batch_id uuid references public.transaction_import_batches(id) on delete set null;

alter table public.transaction_import_batches enable row level security;
alter table public.transaction_import_batches force row level security;

create policy "Users can select own transaction import batches"
  on public.transaction_import_batches for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can insert own transaction import batches"
  on public.transaction_import_batches for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update own transaction import batches"
  on public.transaction_import_batches for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index if not exists transaction_import_batches_user_created_idx
  on public.transaction_import_batches (user_id, created_at desc);
create index if not exists transactions_import_batch_idx
  on public.transactions (user_id, import_batch_id)
  where import_batch_id is not null;

create or replace function private.validate_transaction_import_batch_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.import_batch_id is not null and not exists (
    select 1
    from public.transaction_import_batches
    where id = new.import_batch_id
      and user_id = new.user_id
  ) then
    raise exception 'invalid transaction import batch owner';
  end if;
  return new;
end;
$$;

drop trigger if exists transactions_validate_import_batch_owner on public.transactions;
create trigger transactions_validate_import_batch_owner
before insert or update of user_id, import_batch_id on public.transactions
for each row execute function private.validate_transaction_import_batch_owner();

revoke all on public.transaction_import_batches from public;
revoke all on public.transaction_import_batches from anon;
grant select, insert, update on public.transaction_import_batches to authenticated;

commit;
