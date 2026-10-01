import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  buildPdfReportText,
  buildTransactionsCsvRows,
  ReportsScreen,
} from "@/components/dashboard/reports-screen";
import type { MonthlyReport } from "@/lib/finance/monthly-report";
import type { ReportsData } from "@/lib/finance/transactions";

vi.mock("next/navigation", () => ({
  usePathname: () => "/reports",
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    formatCurrency: (value: number) => `RM${value.toFixed(2)}`,
    formatDate: (value: string | Date) => String(value),
    t: (key: string) =>
      ({
        "screen.reports.cashflowShortfallMetric": "现金流缺口",
        "screen.reports.description": "消费趋势与到期提醒",
        "screen.reports.decreasedBy": "下降",
        "screen.reports.increasedBy": "增加",
        "screen.reports.excessExpenses": "Cashflow shortfall",
        "screen.reports.accountSettlements": "Account settlements",
        "screen.reports.allExpenses": "All expenses",
        "screen.reports.noExpenses": "No expenses",
        "screen.reports.noSettlements": "No settlements",
        "screen.reports.entryKind.repayment": "Card repayment",
      })[key] ?? key,
  }),
}));

const monthlyReport = {
  month: "2026-09",
  core: {
    actualExpenses: 120,
    grossExpenses: 120,
    reimbursedExpenses: 0,
    cashflowShortfall: 120,
    fixedCommitments: 0,
    funMoney: { budget: 0, percentage: 0, remaining: 0, spent: 0 },
    income: 0,
    longTermSavings: 0,
    netBalance: 0,
    safeToSpend: 0,
    sinkingFundReserve: 0,
  },
  spendingByCategory: [],
  specialSpending: { fixedCommitments: 0, funMoney: 0 },
  topExpenses: [],
  largeOneTimeExpenses: [],
  installments: { active: [], endingThisMonth: [], endingNextMonth: [] },
  sinkingFunds: [],
  cooling: {
    abandonedAmount: 0,
    abandonedCount: 0,
    addedCount: 0,
    purchasedCount: 0,
  },
} as unknown as MonthlyReport;

const reportsData = {
  monthlyReports: [
    {
      excessExpenses: 120,
      expenses: 120,
      grossExpenses: 120,
      grossSavings: 0,
      income: 0,
      month: "2026-09",
      monthKey: "screen.reports.month",
      netWorth: 0,
      reimbursedExpenses: 0,
      savings: -120,
      year: "2026",
    },
  ],
  periodMonths: 1,
  selectedMonth: "2026-09",
  transactions: [],
} as unknown as ReportsData;

describe("ReportsScreen", () => {
  it("uses a zero-baseline explanation and negative styling for a deficit", () => {
    const data = {
      ...reportsData,
      monthlyReports: [
        { ...reportsData.monthlyReports[0], income: 120, netWorth: -50 },
        {
          ...reportsData.monthlyReports[0],
          month: "2026-08",
          income: 0,
          netWorth: 0,
        },
      ],
    } as ReportsData;
    const markup = renderToStaticMarkup(
      <ReportsScreen monthlyReport={monthlyReport} reportsData={data} />,
    );
    expect(markup).toContain("screen.reports.lastMonthWasZero");
    expect(markup).not.toContain("100.0% screen.reports.vsLastMonth");
    expect(markup).toMatch(
      /text-muted-foreground[^>]*>screen\.reports\.lastMonthWasZero/,
    );
    expect(markup).toMatch(/text-destructive[^>]*>RM-50\.00<\/p>/);
  });

  it("labels a fictional drop to RM0 as a 100 percent decrease", () => {
    const markup = renderToStaticMarkup(
      <ReportsScreen
        monthlyReport={monthlyReport}
        reportsData={{
          ...reportsData,
          monthlyReports: [
            {
              ...reportsData.monthlyReports[0],
              grossSavings: 0,
            },
            {
              ...reportsData.monthlyReports[0],
              grossSavings: 1750.55,
              month: "2026-08",
            },
          ],
        }}
      />,
    );

    expect(markup).toContain("下降 100% screen.reports.vsLastMonth");
  });

  it("does not render the removed cash-flow shortfall metric", () => {
    const markup = renderToStaticMarkup(
      <ReportsScreen monthlyReport={monthlyReport} reportsData={reportsData} />,
    );

    expect(markup).not.toContain("现金流缺口");
    expect(markup).not.toContain("Cashflow shortfall");
    expect(markup).not.toContain("Fluxo bancário real");
  });

  it("exports repayments as settlements, not living expenses or cash flow", () => {
    const settlement = {
      amount: 40,
      category: "data.category.other",
      date: "2026-10-01",
      description: "Card repayment",
      entryKind: "repayment" as const,
      financialMonth: "2026-10",
      paymentMethod: "Bank",
      purchaseMonth: null,
      statementDueDate: null,
      statementPeriod: null,
      type: "expense" as const,
    };
    const data = {
      ...reportsData,
      transactions: [settlement],
    } as ReportsData;
    const csvRows = buildTransactionsCsvRows(data, (key) =>
      key === "screen.reports.entryKind.repayment" ? "Card repayment" : key,
    );

    expect(csvRows[0]).not.toContain("Fluxo bancário real");
    expect(csvRows.flat().join(" ")).not.toMatch(/cash.?flow/i);
    expect(csvRows[1]).toContain("Card repayment");
    expect(csvRows[1]).toContain("40.00");

    const pdfText = buildPdfReportText({
      reportsData: data,
      monthlyReports: data.monthlyReports,
      formatCurrency: (value) => `RM${value.toFixed(2)}`,
      formatDate: (value) => value,
      t: (key) =>
        ({
          "screen.reports.accountSettlements": "Account settlements",
          "screen.reports.allExpenses": "All expenses",
          "screen.reports.entryKind.repayment": "Card repayment",
          "screen.reports.noExpenses": "No expenses",
          "screen.reports.noSettlements": "No settlements",
        })[key] ?? key,
    });
    const expenseSection = pdfText.split("All expenses\n")[1]?.split("\n\n")[0];

    expect(expenseSection).toContain("No expenses");
    expect(expenseSection).not.toContain("Card repayment");
    expect(pdfText).toContain(
      "Account settlements\n2026-10-01 | Card repayment",
    );
    expect(pdfText).not.toMatch(/cash.?flow/i);
  });
});
