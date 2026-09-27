import { describe, expect, it } from "vitest";

import {
  calculateSafeToSpend,
  getFixedCommitmentsForMonth,
  toMonthlyAmount,
} from "@/lib/finance/safe-to-spend";

function commitment(
  overrides: Partial<
    Parameters<typeof getFixedCommitmentsForMonth>[0][number]
  > = {},
) {
  return {
    amount: 500,
    cadence: "monthly" as const,
    endDate: null,
    id: "commitment-1",
    includeInSafeToSpend: true,
    isEnabled: true,
    startDate: "2026-09-16",
    ...overrides,
  };
}

describe("toMonthlyAmount", () => {
  it("normalizes annual commitments to a monthly amount", () => {
    expect(toMonthlyAmount(1200, "yearly")).toBe(100);
  });

  it("normalizes custom commitments by their interval", () => {
    expect(toMonthlyAmount(900, "custom", 3)).toBe(300);
  });

  it("ignores invalid custom intervals", () => {
    expect(toMonthlyAmount(900, "custom", 0)).toBe(0);
  });
});

describe("calculateSafeToSpend", () => {
  it("reserves a paid fixed commitment once and excludes it from daily spend", () => {
    const result = calculateSafeToSpend({
      income: 5000,
      spent: 2500,
      fixedCommitments: [
        { amount: 2000, cadence: "monthly", paidAmount: 2000 },
      ],
      futureReserves: 300,
      longTermSavings: 500,
    });

    expect(result.paidFixedCommitments).toBe(2000);
    expect(result.fixedCommitments).toBe(2000);
    expect(result.regularSpent).toBe(500);
    expect(result.safeToSpend).toBe(1700);
  });

  it("reserves the full monthly amount for partially paid commitments", () => {
    const result = calculateSafeToSpend({
      income: 5000,
      spent: 700,
      fixedCommitments: [
        { amount: 1200, cadence: "yearly", paidAmount: 0 },
        {
          amount: 900,
          cadence: "custom",
          customIntervalMonths: 3,
          paidAmount: 100,
        },
      ],
      futureReserves: 200,
      longTermSavings: 300,
    });

    expect(result.fixedCommitments).toBe(400);
    expect(result.safeToSpend).toBe(3500);
  });

  it("keeps negative safe-to-spend visible when obligations exceed income", () => {
    const result = calculateSafeToSpend({
      income: 1000,
      spent: 800,
      fixedCommitments: [{ amount: 600, cadence: "monthly" }],
      futureReserves: 100,
      longTermSavings: 100,
    });

    expect(result.safeToSpend).toBe(-600);
  });

  it("excludes commitments explicitly opted out of the calculation", () => {
    const result = calculateSafeToSpend({
      income: 1000,
      spent: 200,
      fixedCommitments: [
        { amount: 500, cadence: "monthly", includeInSafeToSpend: false },
      ],
      futureReserves: 0,
      longTermSavings: 0,
    });

    expect(result.fixedCommitments).toBe(0);
    expect(result.safeToSpend).toBe(800);
  });

  it("uses unpaid due amounts without double-counting paid fixed bills", () => {
    const result = calculateSafeToSpend({
      fixedCommitments: [{ amount: 1000, cadence: "monthly", paidAmount: 400 }],
      futureReserves: 0,
      income: 4000,
      longTermSavings: 0,
      monthlyReserve: 100,
      spent: 900,
      unprepaidDailySpent: 500,
      unpaidDueCommitments: 200,
    });

    expect(result).toMatchObject({
      fixedCommitments: 1000,
      monthlyReserve: 100,
      paidFixedCommitments: 400,
      regularSpent: 500,
      safeToSpend: 2200,
      unpaidDueCommitments: 200,
      unprepaidDailySpent: 500,
    });
  });

  it("keeps a paid RM1000 rent in the monthly reservation", () => {
    const sharedInput = {
      futureReserves: 0,
      income: 3000,
      longTermSavings: 0,
      monthlyReserve: 0,
      unpaidDueCommitments: 0,
    };
    const beforePayment = calculateSafeToSpend({
      ...sharedInput,
      fixedCommitments: [{ amount: 1000, cadence: "monthly", paidAmount: 0 }],
      spent: 0,
      unprepaidDailySpent: 0,
    });
    const afterPayment = calculateSafeToSpend({
      ...sharedInput,
      fixedCommitments: [
        { amount: 1000, cadence: "monthly", paidAmount: 1000 },
      ],
      spent: 1000,
      unprepaidDailySpent: 0,
    });

    expect(beforePayment).toMatchObject({
      fixedCommitments: 1000,
      paidFixedCommitments: 0,
      unprepaidDailySpent: 0,
      safeToSpend: 2000,
    });
    expect(afterPayment).toMatchObject({
      fixedCommitments: 1000,
      paidFixedCommitments: 1000,
      regularSpent: 0,
      unprepaidDailySpent: 0,
      safeToSpend: 2000,
    });
  });
});

describe("getFixedCommitmentsForMonth", () => {
  it("counts a monthly commitment that starts during the selected month", () => {
    const result = getFixedCommitmentsForMonth([commitment()], "2026-09");

    expect(result).toHaveLength(1);
    expect(result[0]?.amount).toBe(500);
  });

  it("uses the same included collection for two commitments and month switches", () => {
    const commitments = [
      commitment({ id: "commitment-1" }),
      commitment({ id: "commitment-2" }),
    ];

    expect(getFixedCommitmentsForMonth(commitments, "2026-08")).toEqual([]);
    expect(getFixedCommitmentsForMonth(commitments, "2026-09")).toHaveLength(2);
    expect(getFixedCommitmentsForMonth(commitments, "2026-10")).toHaveLength(2);
  });

  it("excludes disabled, deleted-range, ended, and opted-out commitments", () => {
    const result = getFixedCommitmentsForMonth(
      [
        commitment({ id: "disabled", isEnabled: false }),
        commitment({ id: "ended", endDate: "2026-08-31" }),
        commitment({ id: "deleted", deletedAt: "2026-09-01T00:00:00.000Z" }),
        commitment({ id: "opted-out", includeInSafeToSpend: false }),
        commitment({ id: "active" }),
      ],
      "2026-09",
    );

    expect(result.map(({ id }) => id)).toEqual(["active"]);
  });

  it("keeps the dashboard commitment total aligned with safe-to-spend", () => {
    const selected = getFixedCommitmentsForMonth(
      [commitment({ id: "first" }), commitment({ id: "second" })],
      "2026-09",
    );
    const result = calculateSafeToSpend({
      fixedCommitments: selected,
      futureReserves: 0,
      income: 2000,
      longTermSavings: 0,
      spent: 0,
    });

    expect(result.fixedCommitments).toBe(1000);
    expect(result.safeToSpend).toBe(1000);
  });
});
