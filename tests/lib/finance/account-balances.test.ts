import { describe, expect, it, vi } from "vitest";

import {
  calculateAccountBalance,
  calculateCreditCardLiability,
  listAccountBalances,
  parseMoneyToCents,
  sumTrackedAccountAssets,
  summarizeAccountFunds,
} from "@/lib/finance/account-balances";

function mockQuery(data: unknown) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  Object.assign(builder, {
    eq: chain,
    is: chain,
    not: chain,
    order: chain,
    select: chain,
    then: (
      resolve: (value: unknown) => void,
      reject: (reason: unknown) => void,
    ) => Promise.resolve({ data, error: null }).then(resolve, reject),
  });
  return builder;
}

describe("account balance calculations", () => {
  it("keeps asset balances separate from current card liability", () => {
    expect(
      summarizeAccountFunds([
        {
          type: "bank",
          currentBalanceCents: 1207302,
          currentLiabilityCents: null,
        },
        {
          type: "credit",
          currentBalanceCents: 999999,
          currentLiabilityCents: 339103,
        },
      ]),
    ).toEqual({ assets: 12073.02, liabilities: 3391.03, netFunds: 8681.99 });
  });
  it("derives current credit-card liability from purchases and linked repayments", () => {
    const purchase = {
      amount: -120,
      date: "2026-09-10",
      entryKind: "purchase" as const,
      notes: null,
      paymentMethodId: "credit-card",
      relatedInvoiceId: null,
      kind: "expense" as const,
    };
    const partialRepayment = {
      amount: -40,
      date: "2026-10-01",
      entryKind: "repayment" as const,
      notes: "invoice_advance:credit-card-invoice:credit-card:2026-10",
      paymentMethodId: "bank",
      relatedInvoiceId: "credit-card-invoice:credit-card:2026-10",
      kind: "expense" as const,
    };
    const fullRepayment = {
      ...partialRepayment,
      amount: -80,
      date: "2026-10-02",
      entryKind: "repayment" as const,
    };
    const refund = {
      ...purchase,
      amount: 20,
      date: "2026-09-20",
      entryKind: "refund" as const,
    };

    expect(
      calculateCreditCardLiability({
        cardId: "credit-card",
        transactions: [purchase],
      }),
    ).toEqual({ amount: 120, cents: 12000 });
    expect(
      calculateCreditCardLiability({
        cardId: "credit-card",
        transactions: [purchase, partialRepayment],
      }),
    ).toEqual({ amount: 80, cents: 8000 });
    expect(
      calculateCreditCardLiability({
        cardId: "credit-card",
        transactions: [purchase, partialRepayment, fullRepayment],
      }),
    ).toEqual({ amount: 0, cents: 0 });
    expect(
      calculateCreditCardLiability({
        cardId: "credit-card",
        transactions: [purchase, refund],
      }),
    ).toEqual({ amount: 100, cents: 10000 });
  });

  it("excludes completed future installment projections from current card liability", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T12:00:00.000Z"));
    try {
      const completedFuture = {
        amount: "0.01",
        date: "2026-10-01",
        entryKind: "purchase" as const,
        installmentCompletedAt: "2026-09-25T12:00:00.000Z",
        installmentGroupId: "group-1",
        installmentNumber: 2,
        installmentTotal: 2,
        kind: "expense" as const,
        paymentMethodId: "card-1",
      };

      expect(
        calculateCreditCardLiability({
          cardId: "card-1",
          transactions: [completedFuture as never],
        }),
      ).toEqual({ amount: 0, cents: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("continues to count active installment purchases and projections", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T12:00:00.000Z"));
    try {
      expect(
        calculateCreditCardLiability({
          cardId: "card-1",
          transactions: [
            {
              amount: "0.01",
              date: "2026-09-10",
              entryKind: "purchase",
              installmentGroupId: "group-1",
              installmentNumber: 1,
              installmentTotal: 2,
              kind: "expense",
              paymentMethodId: "card-1",
            },
            {
              amount: "0.01",
              date: "2026-10-01",
              entryKind: "purchase",
              installmentGroupId: "group-1",
              installmentNumber: 2,
              installmentTotal: 2,
              kind: "expense",
              paymentMethodId: "card-1",
            },
          ],
        }),
      ).toEqual({ amount: 0.02, cents: 2 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves 19 fictional active card purchases totaling RM2,701.50", () => {
    const ordinaryPurchases = [
      ...Array.from({ length: 18 }, (_, index) => ({
        amount: -142.18,
        date: `2026-08-${String(index + 1).padStart(2, "0")}`,
        entryKind: "purchase" as const,
        kind: "expense" as const,
        paymentMethodId: "demo-card",
      })),
      {
        amount: -142.26,
        date: "2026-08-19",
        entryKind: "purchase" as const,
        kind: "expense" as const,
        paymentMethodId: "demo-card",
      },
    ];

    expect(ordinaryPurchases).toHaveLength(19);
    expect(
      calculateCreditCardLiability({
        cardId: "demo-card",
        transactions: ordinaryPurchases,
      }),
    ).toEqual({ amount: 2701.5, cents: 270150 });
    expect(
      calculateCreditCardLiability({
        cardId: "unused-card",
        transactions: ordinaryPurchases,
      }),
    ).toEqual({ amount: 0, cents: 0 });
  });

  it("calculates an exact current balance without floating point drift", () => {
    expect(
      calculateAccountBalance({
        adjustments: ["0.01", "-0.02"],
        openingBalance: "5541.34",
        transactions: [
          { amount: "12.00", date: "2026-09-20", kind: "expense" },
          { amount: "100.00", date: "2026-09-20", kind: "income" },
          { amount: "5.50", date: "2026-09-20", kind: "saving" },
        ],
      }),
    ).toEqual({ cents: 562383, amount: 5623.83 });
  });

  it("rejects money values with more than two decimal places", () => {
    expect(() => parseMoneyToCents("12.345")).toThrow(
      "Amount must have at most two decimal places.",
    );
  });

  it("supports a missing opening balance without changing transaction semantics", () => {
    expect(
      calculateAccountBalance({
        adjustments: [],
        openingBalance: null,
        transactions: [
          { amount: "12.34", date: "2026-09-20", kind: "expense" },
        ],
      }),
    ).toEqual({ cents: -1234, amount: -12.34 });
  });

  it("counts only transactions strictly after the opening date in current balance", () => {
    expect(
      calculateAccountBalance({
        adjustments: ["5.00", "-2.00"],
        openingBalance: "1000.00",
        openingDate: "2026-09-19",
        transactions: [
          { amount: "50.00", date: "2026-09-18", kind: "expense" },
          { amount: "25.00", date: "2026-09-19", kind: "expense" },
          { amount: "30.00", date: "2026-09-20", kind: "expense" },
          { amount: "100.00", date: "2026-09-21", kind: "income" },
          { amount: "10.00", date: "2026-09-22", kind: "saving" },
        ],
      }),
    ).toEqual({ cents: 106300, amount: 1063 });
  });

  it("sums the four opening balances exactly in cents", () => {
    expect(
      sumTrackedAccountAssets([
        { currentBalanceCents: 21835 },
        { currentBalanceCents: 47320 },
        { currentBalanceCents: 428575 },
        { currentBalanceCents: 187550 },
      ]),
    ).toEqual({ cents: 685280, amount: 6852.8 });
  });

  it("exposes card liability instead of a misleading card cash balance", async () => {
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "payment_methods") {
          return mockQuery([
            {
              balance_tracking_enabled: true,
              id: "bank",
              name: "Bank",
              type: "bank",
            },
            {
              balance_tracking_enabled: true,
              id: "credit-card",
              name: "Credit Card",
              type: "credit",
            },
          ]);
        }
        if (table === "account_balance_entries") {
          return mockQuery([
            {
              amount: "1000.00",
              effective_date: "2026-09-01",
              entry_type: "opening_balance",
              id: "opening-bank",
              idempotency_key: null,
              note: null,
              payment_method_id: "bank",
            },
            {
              amount: "0.00",
              effective_date: "2026-09-01",
              entry_type: "opening_balance",
              id: "opening-card",
              idempotency_key: null,
              note: null,
              payment_method_id: "credit-card",
            },
          ]);
        }
        return mockQuery([
          {
            amount: "120.00",
            date: "2026-09-10",
            entry_kind: "purchase",
            kind: "expense",
            notes: null,
            payment_method_id: "credit-card",
            related_invoice_id: null,
          },
          {
            amount: "40.00",
            date: "2026-10-01",
            entry_kind: "repayment",
            kind: "expense",
            notes: null,
            payment_method_id: "bank",
            related_invoice_id: "credit-card-invoice:credit-card:2026-10",
          },
        ]);
      }),
    };

    const balances = await listAccountBalances({
      claims: { sub: "user-1" },
      createdAt: null,
      supabase: supabase as never,
      user: { id: "user-1" } as never,
      userId: "user-1",
    });

    expect(balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentBalanceCents: 96000,
          currentLiabilityCents: null,
          id: "bank",
        }),
        expect.objectContaining({
          currentBalance: null,
          currentBalanceCents: null,
          currentLiability: 80,
          currentLiabilityCents: 8000,
          id: "credit-card",
        }),
      ]),
    );
  });

  it("applies the cutoff independently per account while keeping adjustments", async () => {
    const accountA = "account-a";
    const accountB = "account-b";
    const accountWithoutOpening = "account-without-opening";
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "payment_methods") {
          return mockQuery([
            {
              balance_tracking_enabled: true,
              id: accountA,
              name: "A",
              type: "bank",
            },
            {
              balance_tracking_enabled: true,
              id: accountB,
              name: "B",
              type: "bank",
            },
            {
              balance_tracking_enabled: true,
              id: accountWithoutOpening,
              name: "No opening",
              type: "cash",
            },
          ]);
        }
        if (table === "account_balance_entries") {
          return mockQuery([
            {
              amount: "100.00",
              effective_date: "2026-09-19",
              entry_type: "opening_balance",
              id: "opening-a",
              idempotency_key: null,
              note: null,
              payment_method_id: accountA,
            },
            {
              amount: "5.00",
              effective_date: "2026-09-19",
              entry_type: "adjustment",
              id: "adjustment-a",
              idempotency_key: null,
              note: null,
              payment_method_id: accountA,
            },
            {
              amount: "200.00",
              effective_date: "2026-09-19",
              entry_type: "opening_balance",
              id: "opening-b",
              idempotency_key: null,
              note: null,
              payment_method_id: accountB,
            },
          ]);
        }
        return mockQuery([
          {
            amount: "30.00",
            date: "2026-09-18",
            kind: "expense",
            payment_method_id: accountA,
          },
          {
            amount: "20.00",
            date: "2026-09-19",
            kind: "expense",
            payment_method_id: accountA,
          },
          {
            amount: "10.00",
            date: "2026-09-20",
            kind: "income",
            payment_method_id: accountA,
          },
          {
            amount: "25.00",
            date: "2026-09-20",
            kind: "saving",
            payment_method_id: accountB,
          },
          {
            amount: "7.00",
            date: "2026-09-18",
            kind: "expense",
            payment_method_id: accountWithoutOpening,
          },
        ]);
      }),
    };

    const balances = await listAccountBalances({
      claims: { sub: "user-1" },
      createdAt: null,
      supabase: supabase as never,
      user: { id: "user-1" } as never,
      userId: "user-1",
    });

    expect(balances).toEqual([
      expect.objectContaining({ id: accountA, currentBalanceCents: 11500 }),
      expect.objectContaining({ id: accountB, currentBalanceCents: 17500 }),
      expect.objectContaining({
        id: accountWithoutOpening,
        currentBalanceCents: -700,
      }),
    ]);
  });
});
