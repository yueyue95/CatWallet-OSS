import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20260930081212_cw22_reimbursements.sql",
  "utf8",
)
  .toLowerCase()
  .replace(/\s+/g, " ")
  .trim();

describe("reimbursement migration", () => {
  it("adds an owner-scoped contra-expense relationship and atomic create RPC", () => {
    expect(sql).toContain(
      "add column related_transaction_id uuid references public.transactions(id)",
    );
    expect(sql).toContain(
      "create or replace function public.create_reimbursement",
    );
    expect(sql).toContain("for update");
    expect(sql).toContain("reimbursement total exceeds original expense");
    expect(sql).toContain("invalid original expense for reimbursement owner");
    expect(sql).toContain("entry_idempotency_key = p_idempotency_key");
  });

  it("keeps reimbursements out of ordinary income and offsets personal expense", () => {
    expect(sql).toContain(
      "t.kind = 'income' and t.entry_kind <> 'reimbursement'",
    );
    expect(sql).toContain(
      "when t.kind = 'income' and t.entry_kind = 'reimbursement' then -t.amount",
    );
  });

  it("uses invoker privileges and does not rewrite existing business rows", () => {
    expect(sql).not.toContain("security definer");
    expect(sql).toContain("from anon");
    expect(sql).toContain("to authenticated");
    expect(sql).not.toMatch(/update public\.transactions set entry_kind/i);
    expect(sql).not.toMatch(/delete from public\.transactions/i);
  });
});
