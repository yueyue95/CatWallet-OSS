import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CatWalletSummary } from "@/components/dashboard/catwallet-summary";
import type { CatWalletDashboardData } from "@/lib/finance/catwallet";
import { calculateSafeToSpend } from "@/lib/finance/safe-to-spend";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/dashboard/actions", () => ({
  saveMonthlyAvailableIncomeAction: vi.fn(),
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    formatCurrency: (value: number) => `RM ${Number(value ?? 0).toFixed(2)}`,
    formatDate: (value: string | Date) =>
      String(value).includes("T") ? "2026年9月10日 08:00" : String(value),
    t: (key: string) => key,
  }),
}));

describe("CatWalletSummary", () => {
  it("distinguishes an unset monthly amount from a configured zero", () => {
    const fixture = {
      accountBalances: [],
      month: "2026-09",
      monthlyAmountConfigured: false,
      safeToSpend: {
        dataQuality: "verified",
        income: 0,
        monthlyReserve: 0,
        safeToSpend: 0,
        spent: 0,
      },
    } as unknown as CatWalletDashboardData;
    const unset = renderToStaticMarkup(<CatWalletSummary data={fixture} />);
    expect(unset).toContain("catwallet.notConfigured");
    expect(unset).toContain("catwallet.setMonthlyAvailableIncome");
    expect(unset).not.toContain("catwallet.reconciled");

    const configured = renderToStaticMarkup(
      <CatWalletSummary data={{ ...fixture, monthlyAmountConfigured: true }} />,
    );
    expect(configured).toContain("RM 0.00");
    expect(configured).not.toContain("catwallet.notConfigured");
  });

  it("shows RM 880.00 with a pending badge and named account repair link", () => {
    const safeToSpend = calculateSafeToSpend({
      dataQuality: "partial",
      fixedCommitments: [],
      futureReserves: 0,
      income: 1000,
      longTermSavings: 0,
      monthlyReserve: 0,
      spent: 120,
      unprepaidDailySpent: 120,
    });
    const data = {
      accountBalances: [
        {
          balanceTrackingEnabled: false,
          currentBalance: null,
          name: "验收银行",
          type: "bank",
        },
      ],
      month: "2026-09",
      monthlyAmountConfigured: true,
      refreshedAt: "2026-09-10T00:00:00.000Z",
      safeToSpend,
    } as unknown as CatWalletDashboardData;
    expect(safeToSpend.safeToSpend).toBe(880);
    const pending = renderToStaticMarkup(<CatWalletSummary data={data} />);
    expect(pending).toContain("RM 880.00");
    expect(pending).toContain("catwallet.reconciliationPending");
    expect(pending).toContain("验收银行");
    expect(pending).toContain("catwallet.balanceTrackingOff");
    expect(pending).toContain('href="/payments?month=2026-09"');
    expect(pending).toContain("2026年9月10日 08:00");
    expect(pending).not.toContain("00:00 UTC");

    const verified = renderToStaticMarkup(
      <CatWalletSummary
        data={{
          ...data,
          accountBalances: [
            {
              balanceTrackingEnabled: true,
              currentBalance: 1000,
              name: "验收银行",
              type: "bank",
            },
          ],
          safeToSpend: { ...safeToSpend, dataQuality: "verified" },
        }}
      />,
    );
    expect(verified).toContain("RM 880.00");
    expect(verified).toContain("catwallet.reconciled");
    expect(verified).not.toContain("catwallet.reconciliationPending");
  });

  it("explains missing balances and an empty asset-account list", () => {
    const data = {
      accountBalances: [
        {
          balanceTrackingEnabled: true,
          currentBalance: null,
          name: "未设期初余额的银行",
          type: "bank",
        },
      ],
      month: "2026-09",
      monthlyAmountConfigured: true,
      safeToSpend: { dataQuality: "partial", safeToSpend: 880, income: 0 },
    } as unknown as CatWalletDashboardData;
    const missingBalance = renderToStaticMarkup(
      <CatWalletSummary data={data} />,
    );
    expect(missingBalance).toContain("未设期初余额的银行");
    expect(missingBalance).toContain("catwallet.balanceNotSet");
    const noAccounts = renderToStaticMarkup(
      <CatWalletSummary data={{ ...data, accountBalances: [] }} />,
    );
    expect(noAccounts).toContain("catwallet.noAssetAccounts");
  });

  it("shows assets, card liabilities and net funds from the snapshot", () => {
    const html = renderToStaticMarkup(
      <CatWalletSummary
        data={
          {
            accountBalances: [],
            month: "2026-09",
            monthlyAmountConfigured: true,
            totalAssets: 12073.02,
            totalLiabilities: 3391.03,
            netFunds: 8681.99,
            safeToSpend: {
              dataQuality: "verified",
              safeToSpend: 0,
              income: 0,
              spent: 0,
              monthlyReserve: 0,
            },
          } as unknown as CatWalletDashboardData
        }
      />,
    );
    expect(html).toContain("RM 12073.02");
    expect(html).toContain("RM 3391.03");
    expect(html).toContain("RM 8681.99");
  });
  it("shows the card bill reminder without including it in safe-to-spend", () => {
    const html = renderToStaticMarkup(
      <CatWalletSummary
        data={
          {
            month: "2026-10",
            nextDue: {
              amount: 80,
              date: "2026-10-15",
              descriptionKey: "Card statement",
            },
            safeToSpend: {
              dataQuality: "verified",
              fixedCommitments: 0,
              futureReserves: 0,
              income: 0,
              incomeIsForecast: false,
              longTermSavings: 0,
              monthlyReserve: 0,
              paidFixedCommitments: 0,
              regularSpent: 0,
              safeToSpend: 0,
              spent: 0,
              unpaidDueCommitments: 0,
              unprepaidDailySpent: 0,
            },
          } as unknown as CatWalletDashboardData
        }
      />,
    );

    expect(html).toContain("RM 0.00");
    expect(html).toContain("RM 80.00");
    expect(html).toContain("Card statement");
    expect(html).toContain("catwallet.billReminderOnly");
  });
});
