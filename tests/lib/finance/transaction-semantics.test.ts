import { describe, expect, it } from "vitest";

import {
  getPurchaseMonth,
  getSpendingAmount,
  isRepaymentTransaction,
} from "@/lib/finance/transaction-semantics";

describe("transaction entry semantics", () => {
  it("uses the original purchase date month regardless of card closing day", () => {
    expect(getPurchaseMonth({ date: "2026-09-10" })).toBe("2026-09");
  });

  it("never counts a repayment as spending", () => {
    expect(
      isRepaymentTransaction({ entryKind: "repayment", notes: null }),
    ).toBe(true);
    expect(
      getSpendingAmount({
        amount: -120,
        entryKind: "repayment",
        notes: null,
        type: "expense",
      }),
    ).toBe(0);
  });

  it("recognizes earlier encrypted-note repayments without rewriting them", () => {
    expect(
      isRepaymentTransaction({
        entryKind: undefined,
        notes: "invoice_advance:credit-card-invoice:card:2026-09",
      }),
    ).toBe(true);
  });

  it("treats a refund as negative spending instead of another purchase", () => {
    expect(
      getSpendingAmount({
        amount: -40,
        entryKind: "refund",
        notes: null,
        type: "expense",
      }),
    ).toBe(-40);
  });
});
