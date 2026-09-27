import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("active transaction read migration", () => {
  it("excludes soft-deleted transactions from both cumulative savings inputs", () => {
    const sql = readFileSync(
      "supabase/migrations/20260925100000_active_transaction_reads.sql",
      "utf8",
    ).toLowerCase();

    expect(sql).toContain(
      "create or replace function public.calculate_total_saved",
    );
    expect(sql.match(/t\.deleted_at is null/g)).toHaveLength(2);
    expect(sql).toContain(
      "grant execute on function public.calculate_total_saved(date) to authenticated",
    );
  });

  it("uses one active transaction set for cumulative report inputs", () => {
    const sql = readFileSync(
      "supabase/migrations/20260927100000_reports_cumulative_active_installments.sql",
      "utf8",
    ).toLowerCase();

    expect(sql).toContain("active_transactions as");
    expect(sql.match(/from active_transactions t/g)).toHaveLength(2);
    expect(sql.match(/t\.deleted_at is null/g)).toHaveLength(1);
    expect(sql).toContain("t.installment_completed_at is not null");
    expect(sql).toContain("t.date > current_date");
  });
});
