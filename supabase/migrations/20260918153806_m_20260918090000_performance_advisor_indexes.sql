-- Performance Advisor follow-up.
-- This migration is additive: it adds foreign-key indexes and refreshes the
-- audit policies without changing existing rows or prior migrations.

create index if not exists cooling_items_purchased_transaction_id_idx
  on public.cooling_items (purchased_transaction_id);

create index if not exists fixed_commitments_category_id_idx
  on public.fixed_commitments (category_id);

create index if not exists fixed_commitments_payment_method_id_idx
  on public.fixed_commitments (payment_method_id);

create index if not exists transactions_fixed_commitment_id_idx
  on public.transactions (fixed_commitment_id);

drop policy if exists "mcp mutation audit select own rows"
on public.mcp_mutation_audit;

create policy "mcp mutation audit select own rows"
on public.mcp_mutation_audit
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "mcp mutation audit insert own rows"
on public.mcp_mutation_audit;

create policy "mcp mutation audit insert own rows"
on public.mcp_mutation_audit
for insert
to authenticated
with check ((select auth.uid()) = user_id);
;
