import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20260930091009_cw10_account_transfers.sql",
  "utf8",
)
  .toLowerCase()
  .replace(/\s+/g, " ")
  .trim();

describe("account transfer migration", () => {
  it("models one transfer with two linked ledger sides", () => {
    expect(sql).toContain("create table public.account_transfers");
    expect(sql).toContain("add column transfer_id uuid");
    expect(sql).toContain("add column transfer_side text");
    expect(sql).toContain("source_account_id");
    expect(sql).toContain("destination_account_id");
  });

  it("provides atomic lifecycle RPCs with optimistic conflict detection", () => {
    for (const name of [
      "preview_account_transfer",
      "create_account_transfer",
      "update_account_transfer",
      "delete_account_transfer",
      "restore_account_transfer",
    ]) {
      expect(sql).toContain(`function public.${name}`);
    }
    expect(sql).toContain("expected_revision");
    expect(sql).toContain("transfer was modified by another request");
  });

  it("uses owner RLS and excludes credit accounts without elevated functions", () => {
    expect(sql).toContain(
      "alter table public.account_transfers force row level security",
    );
    expect(sql).toContain("credit accounts require card-payment semantics");
    expect(sql).not.toContain("security definer");
  });

  it("keeps transfer cash flow out of cumulative income and expense", () => {
    expect(sql).toContain(
      "coalesce(t.entry_kind, 'purchase') not in ('reimbursement', 'transfer')",
    );
    expect(sql).toContain(
      "coalesce(t.entry_kind, 'purchase') not in ('repayment', 'transfer')",
    );
  });
});
