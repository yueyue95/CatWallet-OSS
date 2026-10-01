import { describe, expect, it } from "vitest";

import {
  getIncomeAmount,
  getPersonalSpendingAmount,
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

  it("treats reimbursements as contra-expense cash flow instead of ordinary income", () => {
    const purchase = {
      amount: 83.4,
      entryKind: "purchase" as const,
      id: "purchase-1",
      notes: null,
      type: "expense" as const,
    };
    const reimbursements = [
      {
        amount: 20.1,
        entryKind: "reimbursement" as const,
        notes: null,
        relatedTransactionId: "purchase-1",
        type: "income" as const,
      },
      {
        amount: 17.2,
        entryKind: "reimbursement" as const,
        notes: null,
        relatedTransactionId: "purchase-1",
        type: "income" as const,
      },
      {
        amount: 13.3,
        entryKind: "reimbursement" as const,
        notes: null,
        relatedTransactionId: "purchase-1",
        type: "income" as const,
      },
    ];

    expect(getIncomeAmount(reimbursements[0])).toBe(0);
    expect(getPersonalSpendingAmount(purchase, reimbursements)).toBeCloseTo(
      32.8,
      2,
    );
  });

  it("keeps both transfer sides out of income and spending", () => {
    expect(
      getIncomeAmount({
        amount: 175,
        entryKind: "transfer",
        type: "income",
      }),
    ).toBe(0);
    expect(
      getSpendingAmount({
        amount: -150,
        entryKind: "transfer",
        notes: null,
        type: "expense",
      }),
    ).toBe(0);
  });
});
