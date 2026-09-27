import { describe, expect, it } from "vitest";

import {
  buildTransactionImportPreview,
  type TransactionImportRow,
} from "@/lib/finance/transaction-import";

const categoryId = "11111111-1111-4111-8111-111111111111";
const bankId = "22222222-2222-4222-8222-222222222222";
const rowId = (value: string) => `33333333-3333-4333-8333-33333333333${value}`;

function row(
  overrides: Partial<TransactionImportRow> = {},
): TransactionImportRow {
  return {
    amount: 120,
    categoryId,
    date: "2026-09-10",
    description: "Shoes",
    idempotencyKey: rowId("1"),
    notes: null,
    paymentAccountId: bankId,
    type: "expense",
    ...overrides,
  };
}

describe("transaction import preview", () => {
  it("reports row actions, totals, and account impact without writing", () => {
    const preview = buildTransactionImportPreview(
      [
        row(),
        row({ idempotencyKey: rowId("2"), amount: 80, description: "Food" }),
      ],
      [],
      new Set([categoryId]),
      new Set([bankId]),
    );

    expect(preview.counts).toEqual({ create: 2, reject: 0, skip: 0 });
    expect(preview.impact).toEqual({
      count: 2,
      total: 200,
      byPaymentAccount: [{ count: 2, paymentAccountId: bankId, total: 200 }],
    });
    expect(preview.rows.map((item) => item.action)).toEqual([
      "create",
      "create",
    ]);
  });

  it("does not create a second row for an existing or same-batch duplicate", () => {
    const preview = buildTransactionImportPreview(
      [row(), row()],
      [row({ idempotencyKey: "existing-row" })],
      new Set([categoryId]),
      new Set([bankId]),
    );

    expect(preview.counts).toEqual({ create: 0, reject: 0, skip: 2 });
    expect(preview.rows.map((item) => item.reason)).toEqual([
      "possible_duplicate",
      "duplicate_in_batch",
    ]);
  });

  it("rejects an idempotency key reused with a different payload", () => {
    const preview = buildTransactionImportPreview(
      [row(), row({ amount: 121 })],
      [],
      new Set([categoryId]),
      new Set([bankId]),
    );

    expect(preview.counts).toEqual({ create: 1, reject: 1, skip: 0 });
    expect(preview.rows[1]).toMatchObject({
      action: "reject",
      reason: "row_idempotency_conflict",
    });
  });

  it("replays an existing row by idempotency key and rejects a conflicting payload", () => {
    const preview = buildTransactionImportPreview(
      [row(), row({ amount: 121 })],
      [{ ...row(), idempotencyKey: rowId("1") }],
      new Set([categoryId]),
      new Set([bankId]),
    );

    expect(preview.rows).toMatchObject([
      { action: "skip", reason: "row_idempotency_replay" },
      { action: "reject", reason: "row_idempotency_conflict" },
    ]);
    expect(preview.counts).toEqual({ create: 0, reject: 1, skip: 1 });
  });

  it("rejects records that do not belong to the authenticated user's directory", () => {
    const preview = buildTransactionImportPreview(
      [row({ categoryId: "44444444-4444-4444-8444-444444444444" })],
      [],
      new Set([categoryId]),
      new Set([bankId]),
    );

    expect(preview.counts).toEqual({ create: 0, reject: 1, skip: 0 });
    expect(preview.rows[0]).toMatchObject({
      action: "reject",
      reason: "category_not_found",
    });
  });
});
