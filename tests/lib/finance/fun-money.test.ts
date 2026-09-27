import { describe, expect, it } from "vitest";

import {
  calculateFunMoneyStatus,
  sumFunMoneyTransactions,
} from "@/lib/finance/fun-money";

const month = "2026-09";

describe("calculateFunMoneyStatus", () => {
  it("calculates remaining happy money from the monthly allowance", () => {
    expect(calculateFunMoneyStatus({ budget: 500, spent: 125 })).toEqual({
      budget: 500,
      budgetSet: true,
      isOverBudget: false,
      overAmount: 0,
      percentage: 25,
      remaining: 375,
      spent: 125,
    });
  });

  it("keeps over-budget amounts explicit without changing safe-to-spend", () => {
    expect(calculateFunMoneyStatus({ budget: 300, spent: 350 })).toEqual({
      budget: 300,
      budgetSet: true,
      isOverBudget: true,
      overAmount: 50,
      percentage: 117,
      remaining: -50,
      spent: 350,
    });
  });

  it("treats a zero allowance as not configured", () => {
    expect(calculateFunMoneyStatus({ budget: 0, spent: 40 })).toEqual({
      budget: 0,
      budgetSet: false,
      isOverBudget: false,
      overAmount: 0,
      percentage: 0,
      remaining: 0,
      spent: 40,
    });
  });
});

describe("sumFunMoneyTransactions", () => {
  it("counts only marked expenses in the selected month", () => {
    expect(
      sumFunMoneyTransactions(
        [
          {
            amount: 50,
            countsTowardFunMoney: true,
            date: "2026-09-05",
            kind: "expense",
          },
          {
            amount: 50,
            countsTowardFunMoney: false,
            date: "2026-09-06",
            kind: "expense",
          },
          {
            amount: 50,
            countsTowardFunMoney: true,
            date: "2026-09-07",
            kind: "income",
          },
          {
            amount: 50,
            countsTowardFunMoney: true,
            date: "2026-10-01",
            kind: "expense",
          },
        ],
        month,
      ),
    ).toBe(50);
  });

  it("automatically reflects edits, deletions, and month moves", () => {
    const transactions = [
      {
        amount: 30,
        countsTowardFunMoney: true,
        date: "2026-09-05",
        kind: "expense" as const,
      },
      {
        amount: 20,
        countsTowardFunMoney: true,
        date: "2026-09-06",
        kind: "expense" as const,
        deletedAt: "2026-09-07T00:00:00.000Z",
      },
      {
        amount: 40,
        countsTowardFunMoney: true,
        date: "2026-10-01",
        kind: "expense" as const,
      },
    ];

    expect(sumFunMoneyTransactions(transactions, "2026-09")).toBe(30);
    expect(sumFunMoneyTransactions(transactions, "2026-10")).toBe(40);
  });
});
