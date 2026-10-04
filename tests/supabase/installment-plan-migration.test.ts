import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationPath =
  "supabase/migrations/20260930012159_installment_plan_occurrences.sql";
const sql = readFileSync(migrationPath, "utf8")
  .toLowerCase()
  .replace(/\s+/g, " ")
  .trim();
const creationSql = readFileSync(
  "supabase/migrations/20260930031210_cw18_installment_creation.sql",
  "utf8",
)
  .toLowerCase()
  .replace(/\s+/g, " ")
  .trim();
const lifecycleSql = readFileSync(
  "supabase/migrations/20260930034251_cw19_installment_group_lifecycle.sql",
  "utf8",
)
  .toLowerCase()
  .replace(/\s+/g, " ")
  .trim();
const conversionSql = readFileSync(
  "supabase/migrations/20260930085709_cw16_installment_commitment_conversion.sql",
  "utf8",
)
  .toLowerCase()
  .replace(/\s+/g, " ")
  .trim();

describe("installment plan and occurrence migration", () => {
  it("adds plan and occurrence records without rewriting legacy transactions", () => {
    expect(sql).toContain(
      "create table if not exists public.installment_plans",
    );
    expect(sql).toContain(
      "create table if not exists public.installment_occurrences",
    );
    expect(sql).toContain("original_purchase_date date");
    expect(sql).toContain("current_installment smallint not null");
    expect(sql).toContain("total_installments smallint not null");
    expect(sql).toContain("transaction_id uuid");
    expect(sql).toContain("status text not null");
    expect(sql).not.toMatch(
      /(?:update|delete from|insert into) public\.transactions/i,
    );
    expect(sql).not.toMatch(/drop table|truncate/i);
  });

  it("enforces owner-scoped identity and schedule invariants", () => {
    expect(sql).toMatch(/unique\s*\(\s*user_id\s*,\s*idempotency_key\s*\)/i);
    expect(sql).toMatch(/unique\s*\(\s*plan_id\s*,\s*installment_number\s*\)/i);
    expect(sql).toMatch(/current_installment <= total_installments/i);
    expect(sql).toMatch(/installment_number >= current_installment/i);
    expect(sql).toMatch(/installment_number <= total_installments/i);
    expect(sql).toMatch(/transaction_id uuid references public\.transactions/i);
    expect(sql).toMatch(
      /linked_fixed_commitment_id uuid references public\.fixed_commitments/i,
    );
  });

  it("protects both tables with RLS and caller privileges", () => {
    for (const table of ["installment_plans", "installment_occurrences"]) {
      expect(sql).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(sql).toContain(
        `alter table public.${table} force row level security`,
      );
      expect(sql).toMatch(
        new RegExp(
          `on public\\.${table} for select to authenticated using \\(\\(select auth\\.uid\\(\\)\\) is not null and user_id = \\(select auth\\.uid\\(\\)\\)\\)`,
        ),
      );
      expect(sql).toContain(`revoke all on public.${table} from anon`);
    }
    expect(sql).not.toContain("security definer");
  });
});

describe("in-progress installment creation migration", () => {
  it("creates the plan, current transaction, and active schedule atomically", () => {
    expect(creationSql).toContain(
      "create or replace function public.create_installment_plan",
    );
    expect(creationSql).toContain("insert into public.installment_plans");
    expect(creationSql).toContain("insert into public.transactions");
    expect(creationSql).toContain("insert into public.installment_occurrences");
    expect(creationSql).toContain(
      "p_total_installments - p_current_installment + 1",
    );
    expect(creationSql).toContain("p_create_transaction");
  });

  it("uses caller RLS and rejects inconsistent or cross-owner inputs", () => {
    expect(creationSql).not.toContain("security definer");
    expect(creationSql).toContain("v_user_id uuid := auth.uid()");
    expect(creationSql).toContain("request_fingerprint");
    expect(creationSql).toContain("for update");
    expect(creationSql).toContain("from anon");
    expect(creationSql).toContain("to authenticated");
  });
});

describe("installment group lifecycle migration", () => {
  it("soft-deletes and restores the plan and occurrences together", () => {
    expect(lifecycleSql).toContain(
      "create or replace function public.preview_delete_installment",
    );
    expect(lifecycleSql).toContain(
      "create or replace function public.delete_installment",
    );
    expect(lifecycleSql).toContain(
      "create or replace function public.restore_installment",
    );
    expect(lifecycleSql).toContain(
      "update public.installment_occurrences set deleted_at = now()",
    );
    expect(lifecycleSql).toContain(
      "update public.installment_occurrences set deleted_at = null",
    );
  });

  it("blocks active and externally referenced plans without elevated access", () => {
    expect(lifecycleSql).toContain("active_plan");
    expect(lifecycleSql).toContain("external_reference");
    expect(lifecycleSql).toContain("payment_allocation");
    expect(lifecycleSql).toContain(
      "use installment group lifecycle operations",
    );
    expect(lifecycleSql).not.toContain("security definer");
  });

  it("keeps linked transactions in the same reversible lifecycle", () => {
    const migration = readdirSync("supabase/migrations").find((file) =>
      file.endsWith("_cw19_installment_transaction_lifecycle.sql"),
    );
    expect(migration).toBeTruthy();
    const transactionLifecycleSql = readFileSync(
      `supabase/migrations/${migration}`,
      "utf8",
    )
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

    expect(transactionLifecycleSql).toContain(
      "update public.transactions as transaction set deleted_at = v_deleted_at",
    );
    expect(transactionLifecycleSql).toContain(
      "update public.transactions as transaction set deleted_at = null",
    );
    expect(transactionLifecycleSql).toContain(
      "transaction.id = occurrence.transaction_id",
    );
    expect(transactionLifecycleSql).not.toContain("security definer");
  });
});

describe("installment commitment conversion migration", () => {
  it("previews exact commitment correspondence before conversion", () => {
    expect(conversionSql).toContain(
      "create or replace function public.preview_installment_commitment_conversion",
    );
    expect(conversionSql).toContain("amount_mismatch");
    expect(conversionSql).toContain("category_mismatch");
    expect(conversionSql).toContain("payment_method_mismatch");
  });

  it("atomically disables only an eligible linked monthly commitment", () => {
    expect(conversionSql).toContain(
      "create trigger installment_plans_convert_fixed_commitment",
    );
    expect(conversionSql).toContain("new.linked_fixed_commitment_id");
    expect(conversionSql).toContain("set is_enabled = false");
    expect(conversionSql).not.toContain("security definer");
  });
});
