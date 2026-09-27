-- Stage 7: optional cooling list for deliberate non-essential purchases.

create table if not exists public.cooling_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  amount_cents bigint not null check (amount_cents > 0),
  added_at timestamptz not null default now(),
  cooling_days smallint not null default 7 check (cooling_days between 0 and 3650),
  notes text,
  url text,
  status text not null default 'cooling' check (
    status in ('cooling', 'ready', 'abandoned', 'purchased')
  ),
  purchased_transaction_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cooling_items_purchased_transaction_fk
    foreign key (purchased_transaction_id)
    references public.transactions(id)
    on delete set null
);

alter table public.cooling_items enable row level security;
alter table public.cooling_items force row level security;

create policy "Users can select own cooling items"
on public.cooling_items for select to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy "Users can insert own cooling items"
on public.cooling_items for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "Users can update own cooling items"
on public.cooling_items for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Users can delete own cooling items"
on public.cooling_items for delete to authenticated
using (user_id = (select auth.uid()));

create or replace function private.validate_cooling_item_owner_refs()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.purchased_transaction_id is not null and not exists (
    select 1
    from public.transactions
    where id = new.purchased_transaction_id
      and user_id = new.user_id
  ) then
    raise exception 'invalid purchase transaction for cooling item owner';
  end if;

  return new;
end;
$$;

drop trigger if exists cooling_items_validate_owner_refs
on public.cooling_items;
create trigger cooling_items_validate_owner_refs
before insert or update of user_id, purchased_transaction_id
on public.cooling_items
for each row execute function private.validate_cooling_item_owner_refs();

drop trigger if exists cooling_items_touch_updated_at on public.cooling_items;
create trigger cooling_items_touch_updated_at
before update on public.cooling_items
for each row execute function private.touch_catwallet_updated_at();

create index if not exists cooling_items_user_status_idx
on public.cooling_items (user_id, status, added_at desc);

revoke all on public.cooling_items from anon;
grant select, insert, update, delete on public.cooling_items to authenticated;
;
