import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260918153806_m_20260918090000_performance_advisor_indexes.sql",
);

const migration = () =>
  readFileSync(migrationPath, "utf8").toLowerCase().replace(/\s+/g, " ").trim();

describe("Performance Advisor migration", () => {
  it("adds covering indexes for the reported foreign-key columns", () => {
    const sql = migration();

    expect(sql).toContain(
      "create index if not exists cooling_items_purchased_transaction_id_idx on public.cooling_items (purchased_transaction_id);",
    );
    expect(sql).toContain(
      "create index if not exists fixed_commitments_category_id_idx on public.fixed_commitments (category_id);",
    );
    expect(sql).toContain(
      "create index if not exists fixed_commitments_payment_method_id_idx on public.fixed_commitments (payment_method_id);",
    );
    expect(sql).toContain(
      "create index if not exists transactions_fixed_commitment_id_idx on public.transactions (fixed_commitment_id);",
    );
  });

  it("caches auth.uid() in the MCP audit RLS policies", () => {
    const sql = migration();

    expect(sql).toContain(
      'drop policy if exists "mcp mutation audit select own rows" on public.mcp_mutation_audit;',
    );
    expect(sql).toContain(
      'drop policy if exists "mcp mutation audit insert own rows" on public.mcp_mutation_audit;',
    );
    expect(sql).toContain("using ((select auth.uid()) = user_id);");
    expect(sql).toContain("with check ((select auth.uid()) = user_id);");
    expect(sql).not.toMatch(/\bauth\.uid\(\)\s*=\s*user_id/);
  });

  it("is additive and does not reset or delete data", () => {
    const sql = migration();

    expect(sql).not.toMatch(/drop table|truncate|delete\s+from/);
  });
});
