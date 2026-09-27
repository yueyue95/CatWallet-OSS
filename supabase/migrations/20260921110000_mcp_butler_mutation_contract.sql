-- Expand the Butler mutation contract without changing existing audit rows.
-- Idempotency execution state is stored separately from the append-only audit.

begin;

alter table public.mcp_mutation_audit
  add constraint mcp_mutation_audit_tool_name_check_new
  check (tool_name ~ '^[a-z][a-z0-9_]{1,80}$') not valid;

alter table public.mcp_mutation_audit
  validate constraint mcp_mutation_audit_tool_name_check_new;

alter table public.mcp_mutation_audit
  add constraint mcp_mutation_audit_action_check_new
  check (action in ('create', 'update', 'delete', 'restore', 'set', 'adjust', 'record', 'import')) not valid;

alter table public.mcp_mutation_audit
  validate constraint mcp_mutation_audit_action_check_new;

alter table public.mcp_mutation_audit
  drop constraint mcp_mutation_audit_tool_name_check;

alter table public.mcp_mutation_audit
  drop constraint mcp_mutation_audit_action_check;

alter table public.mcp_mutation_audit
  rename constraint mcp_mutation_audit_tool_name_check_new
  to mcp_mutation_audit_tool_name_check;

alter table public.mcp_mutation_audit
  rename constraint mcp_mutation_audit_action_check_new
  to mcp_mutation_audit_action_check;

create table public.mcp_mutation_idempotency (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_name text not null check (tool_name ~ '^[a-z][a-z0-9_]{1,80}$'),
  idempotency_key_hash text not null check (char_length(idempotency_key_hash) = 64),
  payload_hash text not null check (char_length(payload_hash) = 64),
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  result_entity_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, tool_name, idempotency_key_hash)
);

alter table public.mcp_mutation_idempotency enable row level security;
alter table public.mcp_mutation_idempotency force row level security;

create policy "mcp mutation idempotency select own rows"
  on public.mcp_mutation_idempotency
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "mcp mutation idempotency insert own rows"
  on public.mcp_mutation_idempotency
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "mcp mutation idempotency update own rows"
  on public.mcp_mutation_idempotency
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.mcp_mutation_idempotency from public;
revoke all on table public.mcp_mutation_idempotency from anon;
revoke all on table public.mcp_mutation_idempotency from authenticated;
grant select, insert, update on table public.mcp_mutation_idempotency to authenticated;

commit;
