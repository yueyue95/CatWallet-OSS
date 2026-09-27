import { describe, expect, it } from "vitest";

import {
  buildMonthlyReport,
  type MonthlyReportSource,
} from "@/lib/finance/monthly-report";

function source(
  overrides: Partial<MonthlyReportSource> = {},
): MonthlyReportSource {
  return {
    month: "2026-09",
    transactions: [],
    dashboard: {
      fixedCommitments: [],
      month: "2026-09",
      safeToSpend: {
        dataQuality: "verified",
        fixedCommitments: 500,
        futureReserves: 100,
        income: 2000,
        incomeIsForecast: false,
        longTermSavings: 200,
        monthlyReserve: 300,
        paidFixedCommitments: 0,
        regularSpent: 300,
        safeToSpend: 900,
        spent: 300,
        unpaidDueCommitments: 0,
        unprepaidDailySpent: 300,
      },
      sinkingFunds: [],
    },
    funMoney: {
      budget: 300,
      budgetSet: true,
      isOverBudget: false,
      month: "2026-09",
      overAmount: 0,
      percentage: 16.67,
      remaining: 250,
      spent: 50,
    },
    installments: [],
    sinkingFunds: [],
    coolingItems: [],
    ...overrides,
  };
}

function expense(overrides: Record<string, unknown> = {}) {
  return {
    amount: -50,
    categoryKey: "data.category.food",
    countsTowardFunMoney: false,
    date: "2026-09-10",
    descriptionKey: "Lunch",
    fixedCommitmentId: null,
    group: "needs" as const,
    id: "expense-1",
    type: "expense" as const,
    ...overrides,
  };
}

describe("buildMonthlyReport", () => {
  it("keeps transactions on either side of an opening date in their month report", () => {
    const report = buildMonthlyReport(
      source({
        month: "2026-09",
        transactions: [
          expense({ id: "before-opening", amount: -25, date: "2026-09-18" }),
          expense({ id: "opening-date", amount: -15, date: "2026-09-19" }),
          expense({ id: "after-opening", amount: -12, date: "2026-09-20" }),
        ],
      }),
    );

    expect(report.core.actualExpenses).toBe(52);
    expect(report.topExpenses.map((item) => item.id)).toEqual([
      "before-opening",
      "opening-date",
      "after-opening",
    ]);
  });

  it("builds core summary and real category spending without double counting fun money", () => {
    const report = buildMonthlyReport(
      source({
        transactions: [
          expense({ id: "food", amount: -50 }),
          expense({
            id: "fun",
            amount: -80,
            categoryKey: "data.category.leisure",
            countsTowardFunMoney: true,
          }),
          expense({
            id: "commitment",
            amount: -500,
            categoryKey: "data.category.housing",
            fixedCommitmentId: "commitment-1",
          }),
          {
            amount: 2000,
            categoryKey: "data.category.receipts",
            date: "2026-09-01",
            descriptionKey: "Salary",
            group: "income" as const,
            id: "income-1",
            type: "income" as const,
          },
          {
            amount: -200,
            categoryKey: "data.category.investments",
            date: "2026-09-12",
            descriptionKey: "Savings",
            group: "savings" as const,
            id: "saving-1",
            type: "saving" as const,
          },
        ],
      }),
    );

    expect(report.core).toMatchObject({
      actualExpenses: 630,
      income: 2000,
      longTermSavings: 200,
      sinkingFundReserve: 100,
      safeToSpend: 900,
    });
    expect(report.core.funMoney).toEqual({
      budget: 300,
      remaining: 250,
      spent: 50,
      percentage: 16.67,
    });
    expect(report.spendingByCategory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "data.category.food", amount: 50 }),
        expect.objectContaining({ key: "data.category.leisure", amount: 80 }),
        expect.objectContaining({ key: "data.category.housing", amount: 500 }),
      ]),
    );
    expect(report.specialSpending).toEqual({
      fixedCommitments: 500,
      funMoney: 80,
    });
  });

  it("keeps repayments out of spending and applies refunds to the purchase total", () => {
    const report = buildMonthlyReport(
      source({
        transactions: [
          expense({ id: "purchase", amount: -120 }),
          expense({
            id: "refund",
            amount: -20,
            entryKind: "refund",
          }),
          expense({
            id: "repayment",
            amount: -120,
            entryKind: "repayment",
            relatedInvoiceId: "invoice-1",
          }),
        ],
      }),
    );

    expect(report.core.actualExpenses).toBe(100);
    expect(report.core.safeToSpend).toBe(900);
    expect(report.core).not.toHaveProperty("cashflowShortfall");
    expect(report.spendingByCategory).toEqual([
      expect.objectContaining({ amount: 100, count: 2 }),
    ]);
    expect(report.topExpenses.map((item) => item.id)).toEqual([
      "purchase",
      "refund",
    ]);
  });

  it("reports top three actual expenses and large one-time events", () => {
    const report = buildMonthlyReport(
      source({
        transactions: [
          expense({ id: "small", amount: -40 }),
          expense({ id: "large-1", amount: -1200, descriptionKey: "Repair" }),
          expense({ id: "large-2", amount: -800, descriptionKey: "Furniture" }),
          expense({ id: "large-3", amount: -600, descriptionKey: "Travel" }),
          expense({
            id: "installment",
            amount: -900,
            installmentGroupId: "g1",
          }),
        ],
      }),
    );

    expect(report.topExpenses.map((item) => item.id)).toEqual([
      "large-1",
      "installment",
      "large-2",
    ]);
    expect(report.largeOneTimeExpenses.map((item) => item.id)).toEqual([
      "large-1",
      "large-2",
      "large-3",
    ]);
  });

  it("summarizes installments, sinking funds, and cooling outcomes for the selected month", () => {
    const report = buildMonthlyReport(
      source({
        installments: [
          {
            amountMode: "per_installment",
            allocations: [],
            currentInstallment: 5,
            endDate: "2026-09-20",
            groupId: "installment-1",
            monthlyAmount: 500,
            name: "Demo Flex Plan",
            paidAmount: 2500,
            paidInstallments: 5,
            remainingAmount: 500,
            remainingInstallments: 1,
            retired: false,
            retirementStartsMonth: "2026-10",
            totalAmount: 3000,
            totalInstallments: 6,
          },
        ],
        sinkingFunds: [
          {
            currentAmount: 350,
            emoji: "🚗",
            expectedUseDate: "2027-01-01",
            id: "fund-1",
            isEnabled: true,
            monthlyTarget: 100,
            name: "车车基金",
            notes: null,
            targetAmount: 1000,
          },
        ],
        coolingItems: [
          {
            addedAt: "2026-09-02T00:00:00.000Z",
            amountCents: 80000,
            coolingDays: 7,
            createdAt: "2026-09-02T00:00:00.000Z",
            id: "cool-1",
            name: "Printer",
            notes: null,
            purchasedTransactionId: "tx-purchase",
            status: "purchased",
            updatedAt: "2026-09-10T00:00:00.000Z",
            url: null,
          },
          {
            addedAt: "2026-09-03T00:00:00.000Z",
            amountCents: 50000,
            coolingDays: 7,
            createdAt: "2026-09-03T00:00:00.000Z",
            id: "cool-2",
            name: "Headphones",
            notes: null,
            purchasedTransactionId: null,
            status: "abandoned",
            updatedAt: "2026-09-05T00:00:00.000Z",
            url: null,
          },
        ],
      }),
    );

    expect(
      report.installments.endingThisMonth.map((item) => item.groupId),
    ).toEqual(["installment-1"]);
    expect(report.sinkingFunds[0]).toMatchObject({
      currentAmount: 350,
      monthlyIncrease: 100,
      progress: 35,
    });
    expect(report.cooling).toEqual({
      abandonedAmount: 500,
      abandonedCount: 1,
      addedCount: 2,
      purchasedCount: 1,
    });
  });
});
