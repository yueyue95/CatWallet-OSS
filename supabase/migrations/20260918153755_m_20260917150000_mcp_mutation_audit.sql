create table public.mcp_mutation_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_name text not null check (tool_name = 'create_transaction'),
  action text not null check (action = 'create'),
  entity_id uuid,
  idempotency_key_hash text not null check (char_length(idempotency_key_hash) = 64),
  request_fingerprint text not null check (char_length(request_fingerprint) = 64),
  occurred_at timestamptz not null default timezone('utc', now()),
  success boolean not null,
  error_code text,
  constraint mcp_mutation_audit_success_error_check check (
    (success and error_code is null) or
    (not success and error_code is not null)
  )
);

create index mcp_mutation_audit_lookup_idx
  on public.mcp_mutation_audit (user_id, tool_name, idempotency_key_hash, occurred_at desc)
  where success = true;

alter table public.mcp_mutation_audit enable row level security;
alter table public.mcp_mutation_audit force row level security;

create policy "mcp mutation audit select own rows"
  on public.mcp_mutation_audit
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "mcp mutation audit insert own rows"
  on public.mcp_mutation_audit
  for insert
  to authenticated
  with check (auth.uid() = user_id);

revoke all on table public.mcp_mutation_audit from anon;
grant insert, select on table public.mcp_mutation_audit to authenticated;
;
