import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCatWalletDashboardData,
  setMonthlyAvailableIncome,
  updateSinkingFund,
} from "@/lib/finance/catwallet";
import type { AccountBalance } from "@/lib/finance/account-balances";
import { createCreditCardInvoiceTransactions } from "@/lib/finance/credit-card-invoices";
import type { Transaction } from "@/lib/data";
import type {
  AuthenticatedUserContext,
  ListTransactionsOptions,
} from "@/lib/finance/transactions";

const { listAccountBalances, listTransactions, summarizeAccountFunds } =
  vi.hoisted(() => ({
    listAccountBalances: vi.fn(),
    listTransactions: vi.fn(),
    summarizeAccountFunds: vi.fn(),
  }));

vi.mock("@/lib/finance/account-balances", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/finance/account-balances")>()),
  listAccountBalances,
  summarizeAccountFunds,
}));
vi.mock("@/lib/finance/transactions", () => ({
  getUserContext: vi.fn(),
  listTransactions,
}));

type Scenario = {
  balances: AccountBalance[];
  budgetIncome?: number | null;
  invoices: Array<{
    amount: number;
    date: string;
    descriptionKey: string;
    isCreditCardInvoice: true;
  }>;
  transactions: Array<{
    amount: number;
    date: string;
    entry_kind: "purchase" | "repayment" | null;
    fixed_commitment_id: null;
    installment_completed_at?: string | null;
    installment_group_id?: string | null;
    installment_number?: number | null;
    installment_total?: number | null;
    kind: "expense" | "income";
    notes: null;
  }>;
};
type TestContext = AuthenticatedUserContext & { scenario: Scenario };

function query(data: unknown, single: unknown = null) {
  const promise = Promise.resolve({ data, error: null });
  const chain = new Proxy(promise, {
    get(target, property) {
      if (property === "then") return target.then.bind(target);
      if (property === "maybeSingle")
        return () => Promise.resolve({ data: single, error: null });
      return () => chain;
    },
  });
  return chain;
}

function context(scenario: Scenario): AuthenticatedUserContext {
  const supabase = {
    from: (table: string) =>
      query(
        table === "transactions" ? scenario.transactions : [],
        table === "monthly_budgets" && scenario.budgetIncome !== undefined
          ? { income: scenario.budgetIncome, savings_limit: 0 }
          : null,
      ),
  };
  return {
    scenario,
    supabase: supabase as unknown as AuthenticatedUserContext["supabase"],
    userId: "11111111-1111-4111-8111-111111111111",
  } as TestContext;
}

function dashboard(
  month: string,
  bank: number,
  liability: number,
  transactions: Scenario["transactions"],
  outstanding: number,
) {
  const invoices =
    outstanding > 0
      ? [
          {
            amount: -outstanding,
            date: "2026-10-15",
            descriptionKey: "Card statement",
            isCreditCardInvoice: true as const,
          },
        ]
      : [];
  return getCatWalletDashboardData(
    month,
    context({
      balances: [
        {
          balanceTrackingEnabled: true,
          currentBalance: bank,
          currentLiability: null,
          id: "bank",
        },
        {
          balanceTrackingEnabled: true,
          currentBalance: null,
          currentLiability: liability,
          id: "card",
        },
      ] as unknown as AccountBalance[],
      invoices,
      transactions,
    }),
  );
}

function transaction(
  amount: number,
  date: string,
  entry_kind: "purchase" | "repayment",
) {
  return {
    amount: -amount,
    date,
    entry_kind,
    fixed_commitment_id: null,
    kind: "expense" as const,
    notes: null,
  };
}

function incomeTransaction(amount: number, date: string) {
  return {
    amount,
    date,
    entry_kind: null,
    fixed_commitment_id: null,
    kind: "income" as const,
    notes: null,
  };
}

function creditCardTransaction(
  overrides: Partial<Transaction> & Pick<Transaction, "amount" | "date" | "id">,
): Transaction {
  return {
    amount: overrides.amount,
    categoryKey: "data.category.shopping",
    date: overrides.date,
    descriptionKey: "Synthetic purchase",
    group: "wants",
    icon: "card",
    id: overrides.id,
    paymentMethodClosingDay: 7,
    paymentMethodDueDay: 14,
    paymentMethodId: "card",
    paymentMethodKey: "Synthetic card",
    paymentMethodType: "credit",
    type: "expense",
    ...overrides,
  };
}

describe("getCatWalletDashboardData credit card accounting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listAccountBalances).mockImplementation(
      async (ctx: AuthenticatedUserContext) =>
        (ctx as TestContext).scenario.balances,
    );
    vi.mocked(summarizeAccountFunds).mockReturnValue({
      assets: 0,
      liabilities: 0,
      netFunds: 0,
    });
    vi.mocked(listTransactions).mockImplementation(
      async (options: ListTransactionsOptions) =>
        (options.userContext as TestContext).scenario.invoices as never,
    );
  });

  it("counts purchases once and keeps repayments out of later-month spending", async () => {
    const [baseline, september, octoberBefore, after40, after80] =
      await Promise.all([
        dashboard("2026-09", 1000, 0, [], 0),
        dashboard(
          "2026-09",
          1000,
          120,
          [transaction(120, "2026-09-10", "purchase")],
          120,
        ),
        dashboard("2026-10", 1000, 120, [], 120),
        dashboard(
          "2026-10",
          960,
          80,
          [transaction(40, "2026-10-01", "repayment")],
          80,
        ),
        dashboard(
          "2026-10",
          880,
          0,
          [
            transaction(40, "2026-10-01", "repayment"),
            transaction(80, "2026-10-02", "repayment"),
          ],
          0,
        ),
      ] as const);

    expect(
      baseline.safeToSpend.safeToSpend - september.safeToSpend.safeToSpend,
    ).toBe(120);
    expect(september).toMatchObject({
      accountBalances: [{ currentBalance: 1000 }, { currentLiability: 120 }],
      nextDue: { amount: 120, date: "2026-10-15" },
      safeToSpend: { safeToSpend: -120, spent: 120 },
    });
    expect(
      [octoberBefore, after40, after80].map((data) => ({
        bank: data.accountBalances[0]?.currentBalance,
        liability: data.accountBalances[1]?.currentLiability,
        nextDue: data.nextDue?.amount ?? null,
        safe: data.safeToSpend.safeToSpend,
        spent: data.safeToSpend.spent,
      })),
    ).toEqual([
      { bank: 1000, liability: 120, nextDue: 120, safe: 0, spent: 0 },
      { bank: 960, liability: 80, nextDue: 80, safe: 0, spent: 0 },
      { bank: 880, liability: 0, nextDue: null, safe: 0, spent: 0 },
    ]);
  });

  it("removes a stale invoice once the card liability is fully repaid", async () => {
    const { invoices } = createCreditCardInvoiceTransactions({
      month: "2026-05",
      paymentMethods: [
        {
          closingDay: 7,
          dueDay: 14,
          id: "card",
          labelKey: "Synthetic card",
        },
      ],
      transactions: [
        creditCardTransaction({
          amount: -100,
          date: "2026-04-01",
          id: "prior-purchase",
        }),
        creditCardTransaction({
          amount: -75,
          date: "2026-04-20",
          id: "current-purchase",
        }),
        creditCardTransaction({
          amount: -175,
          date: "2026-05-05",
          entryKind: "repayment",
          id: "full-repayment",
          paymentMethodId: "bank",
          paymentMethodType: "bank",
          relatedInvoiceId: "credit-card-invoice:card:2026-04",
        }),
      ],
    });
    const result = await getCatWalletDashboardData(
      "2026-05",
      context({
        balances: [
          {
            balanceTrackingEnabled: true,
            currentBalance: 825,
            currentLiability: null,
            id: "bank",
          },
          {
            balanceTrackingEnabled: true,
            currentBalance: null,
            currentLiability: 0,
            id: "card",
          },
        ] as unknown as AccountBalance[],
        invoices,
        transactions: [],
      }),
    );

    expect(result.nextDue).toBeNull();
  });

  it("does not revive a repaid invoice after a next-cycle purchase", async () => {
    const invoiceTransactions = [
      creditCardTransaction({
        amount: -100,
        date: "2026-04-01",
        id: "prior-purchase",
      }),
      creditCardTransaction({
        amount: -75,
        date: "2026-04-20",
        id: "current-purchase",
      }),
      creditCardTransaction({
        amount: -175,
        date: "2026-05-05",
        entryKind: "repayment",
        id: "full-repayment",
        paymentMethodId: "bank",
        paymentMethodType: "bank",
        relatedInvoiceId: "credit-card-invoice:card:2026-04",
      }),
      creditCardTransaction({
        amount: -25,
        date: "2026-05-07",
        id: "next-cycle-purchase",
      }),
    ];
    const { invoices } = createCreditCardInvoiceTransactions({
      month: "2026-05",
      paymentMethods: [
        {
          closingDay: 7,
          dueDay: 14,
          id: "card",
          labelKey: "Synthetic card",
        },
      ],
      transactions: invoiceTransactions,
    });
    const result = await getCatWalletDashboardData(
      "2026-05",
      context({
        balances: [
          {
            balanceTrackingEnabled: true,
            currentBalance: 825,
            currentLiability: null,
            id: "bank",
          },
          {
            balanceTrackingEnabled: true,
            currentBalance: null,
            currentLiability: 25,
            id: "card",
          },
        ] as unknown as AccountBalance[],
        invoices,
        transactions: [transaction(25, "2026-05-07", "purchase")],
      }),
    );

    expect(result.accountBalances[1]?.currentLiability).toBe(25);
    expect(result.nextDue).toBeNull();
  });

  it("does not leave a closed invoice due after a legacy balance correction", async () => {
    const { invoices } = createCreditCardInvoiceTransactions({
      balanceAdjustments: [
        {
          amount: 300,
          effectiveDate: "2026-05-08",
          paymentMethodId: "card",
        },
        {
          amount: -600,
          effectiveDate: "2026-05-08",
          paymentMethodId: "card",
        },
      ],
      month: "2026-05",
      paymentMethods: [
        {
          closingDay: 7,
          dueDay: 14,
          id: "card",
          labelKey: "Synthetic card",
        },
      ],
      transactions: [
        creditCardTransaction({
          amount: -300,
          date: "2026-04-20",
          id: "closed-invoice-purchase",
        }),
        creditCardTransaction({
          amount: -40,
          date: "2026-05-07",
          id: "next-cycle-purchase",
        }),
      ],
    });
    const result = await getCatWalletDashboardData(
      "2026-05",
      context({
        balances: [
          {
            balanceTrackingEnabled: true,
            currentBalance: null,
            currentLiability: 40,
            id: "card",
          },
        ] as unknown as AccountBalance[],
        invoices,
        transactions: [transaction(40, "2026-05-07", "purchase")],
      }),
    );

    expect(result.accountBalances[0]?.currentLiability).toBe(40);
    expect(result.nextDue).toBeNull();
  });

  it("does not count a completed installment projection in future-month spending", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T12:00:00.000Z"));
    try {
      const result = await dashboard(
        "2026-10",
        1000,
        0,
        [
          {
            ...transaction(0.01, "2026-10-01", "purchase"),
            installment_group_id: "group-1",
            installment_number: 2,
            installment_total: 2,
            installment_completed_at: "2026-09-25T12:00:00.000Z",
          },
        ],
        0,
      );

      expect(result.safeToSpend).toMatchObject({ regularSpent: 0, spent: 0 });
      expect(result.nextDue).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("distinguishes an explicitly configured zero available income from no monthly amount", async () => {
    const scenario = {
      balances: [
        { balanceTrackingEnabled: true, currentBalance: 1000 },
      ] as AccountBalance[],
      invoices: [],
      transactions: [],
    };
    const unset = await getCatWalletDashboardData("2026-09", context(scenario));
    const configuredZero = await getCatWalletDashboardData(
      "2026-09",
      context({ ...scenario, budgetIncome: 0 }),
    );
    expect(unset.monthlyAmountConfigured).toBe(false);
    expect(configuredZero.monthlyAmountConfigured).toBe(true);
    expect(configuredZero.safeToSpend).toMatchObject({
      income: 0,
      safeToSpend: 0,
      dataQuality: "verified",
    });
  });

  it("does not mark the snapshot reconciled while an asset account is untracked", async () => {
    const result = await getCatWalletDashboardData(
      "2026-09",
      context({
        balances: [
          { type: "bank", balanceTrackingEnabled: true, currentBalance: 1000 },
          { type: "cash", balanceTrackingEnabled: false, currentBalance: null },
        ] as AccountBalance[],
        budgetIncome: 0,
        invoices: [],
        transactions: [],
      }),
    );
    expect(result.safeToSpend.dataQuality).toBe("partial");
  });

  it("keeps the calculable RM 880 amount when account tracking is incomplete", async () => {
    const result = await getCatWalletDashboardData(
      "2026-09",
      context({
        balances: [
          {
            type: "bank",
            name: "验收银行",
            balanceTrackingEnabled: false,
            currentBalance: null,
          },
        ] as AccountBalance[],
        budgetIncome: 1000,
        invoices: [],
        transactions: [transaction(120, "2026-09-10", "purchase")],
      }),
    );
    expect(result.monthlyAmountConfigured).toBe(true);
    expect(result.safeToSpend).toMatchObject({
      income: 1000,
      dataQuality: "partial",
      safeToSpend: 880,
      spent: 120,
      unprepaidDailySpent: 120,
    });
  });
});

describe("getCatWalletDashboardData income selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listAccountBalances).mockResolvedValue([]);
    vi.mocked(summarizeAccountFunds).mockReturnValue({
      assets: 0,
      liabilities: 0,
      netFunds: 0,
    });
    vi.mocked(listTransactions).mockResolvedValue([] as never);
  });

  it("uses actual income when present and budget income only as fallback", async () => {
    const cases = [
      {
        budgetIncome: 5000,
        incomeTransactions: [incomeTransaction(5000, "2026-09-05")],
        expectedIncome: 5000,
        expectedForecast: false,
      },
      {
        budgetIncome: 5000,
        incomeTransactions: [],
        expectedIncome: 5000,
        expectedForecast: true,
      },
      {
        incomeTransactions: [incomeTransaction(5000, "2026-09-05")],
        expectedIncome: 5000,
        expectedForecast: false,
      },
      {
        budgetIncome: 5000,
        incomeTransactions: [incomeTransaction(6000, "2026-09-05")],
        expectedIncome: 6000,
        expectedForecast: false,
      },
    ];

    const results = await Promise.all(
      cases.map(({ budgetIncome, incomeTransactions }) =>
        getCatWalletDashboardData(
          "2026-09",
          context({
            balances: [],
            budgetIncome,
            invoices: [],
            transactions: incomeTransactions,
          }),
        ),
      ),
    );

    expect(
      results.map(({ safeToSpend }) => ({
        incomeIsForecast: safeToSpend.incomeIsForecast,
        income: safeToSpend.income,
        safeToSpend: safeToSpend.safeToSpend,
      })),
    ).toEqual(
      cases.map(({ expectedForecast, expectedIncome }) => ({
        incomeIsForecast: expectedForecast,
        income: expectedIncome,
        safeToSpend: expectedIncome,
      })),
    );
  });
});

describe("monthly available income", () => {
  it("stores an explicit zero on the selected month without a transaction", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const ctx = {
      userId: "11111111-1111-4111-8111-111111111111",
      supabase: { from: vi.fn(() => ({ upsert })) },
    } as unknown as AuthenticatedUserContext;
    await setMonthlyAvailableIncome({ month: "2026-09", amount: 0 }, ctx);
    expect(ctx.supabase.from).toHaveBeenCalledWith("monthly_budgets");
    expect(upsert).toHaveBeenCalledWith(
      { month: "2026-09-01", user_id: ctx.userId, income: 0 },
      { onConflict: "user_id,month" },
    );
    await setMonthlyAvailableIncome({ month: "2026-09", amount: 0.29 }, ctx);
    expect(upsert).toHaveBeenLastCalledWith(
      { month: "2026-09-01", user_id: ctx.userId, income: 0.29 },
      { onConflict: "user_id,month" },
    );
    await expect(
      setMonthlyAvailableIncome({ month: "2026-09", amount: -1 }, ctx),
    ).rejects.toThrow();
  });
});

describe("updateSinkingFund", () => {
  it("does not overwrite the current amount when editing metadata", async () => {
    const row = {
      current_amount: 1,
      deleted_at: null,
      emoji: "🚗",
      expected_use_date: null,
      id: "22222222-2222-4222-8222-222222222222",
      is_enabled: true,
      monthly_target: 250,
      name: "Updated trip fund",
      notes: null,
      target_amount: 1000,
    };
    const response = Promise.resolve({ data: row, error: null });
    const update = vi.fn();
    const builder = new Proxy(response, {
      get(target, property) {
        if (property === "then") return target.then.bind(target);
        if (property === "update") return update;
        if (property === "single") return () => response;
        return () => builder;
      },
    });
    update.mockImplementation(() => builder);
    const userContext = {
      supabase: { from: vi.fn(() => builder) },
      userId: "11111111-1111-4111-8111-111111111111",
    } as unknown as AuthenticatedUserContext;

    const result = await updateSinkingFund(
      {
        currentAmount: 0,
        emoji: "🚗",
        id: row.id,
        monthlyTarget: 250,
        name: "Updated trip fund",
      },
      userContext,
    );

    expect(update).toHaveBeenCalledWith(
      expect.not.objectContaining({ current_amount: expect.anything() }),
    );
    expect(result.currentAmount).toBe(1);
  });
});
