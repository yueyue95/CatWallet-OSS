import { describe, expect, it } from "vitest";

import {
  buildActiveInstallmentSchedule,
  buildInstallmentPlan,
  type InstallmentAmountMode,
} from "@/lib/finance/installment-plan";

function plan(
  amount: number,
  count: number,
  mode: InstallmentAmountMode,
  currentInstallment = 1,
) {
  return buildInstallmentPlan({
    amount,
    amountMode: mode,
    currentInstallment,
    installmentCount: count,
  });
}

describe("installment amount modes", () => {
  it("keeps the entered per-installment amount and calculates RM500 x 6", () => {
    expect(plan(500, 6, "per_installment", 5)).toMatchObject({
      amountMode: "per_installment",
      currentInstallment: 5,
      installmentAmount: 500,
      installmentAmounts: [500, 500, 500, 500, 500, 500],
      remainingAmount: 500,
      remainingInstallments: 1,
      totalAmount: 3000,
    });
  });

  it("uses cents without drift for RM283.47 x 12", () => {
    const result = plan(283.47, 12, "per_installment", 9);
    expect(result.totalAmount).toBeCloseTo(3401.64, 2);
    expect(result.remainingAmount).toBeCloseTo(850.41, 2);
    expect(result.installmentAmounts).toHaveLength(12);
    result.installmentAmounts.forEach((amount) =>
      expect(amount).toBeCloseTo(283.47, 2),
    );
  });

  it("preserves total mode rounding for legacy RM500 / 6", () => {
    expect(plan(500, 6, "total").installmentAmounts).toEqual([
      83.33, 83.33, 83.33, 83.33, 83.33, 83.35,
    ]);
  });

  it("rejects a current installment outside the planned range", () => {
    expect(() => plan(500, 6, "per_installment", 7)).toThrow(
      "Current installment is invalid",
    );
  });

  it("rejects a total amount that would create a zero-value occurrence", () => {
    expect(() => plan(0.01, 2, "total")).toThrow(
      "Amount is below the minimum per installment.",
    );
  });
});

describe("active installment schedule", () => {
  it("keeps only the evidenced current occurrence and future plan", () => {
    expect(
      buildActiveInstallmentSchedule({
        amount: 137,
        amountMode: "per_installment",
        currentInstallment: 10,
        currentOccurrenceDate: "2026-09-30",
        installmentCount: 12,
      }),
    ).toEqual([
      {
        amount: 137,
        dueDate: "2026-09-30",
        installmentNumber: 10,
        status: "posted",
      },
      {
        amount: 137,
        dueDate: "2026-10-30",
        installmentNumber: 11,
        status: "planned",
      },
      {
        amount: 137,
        dueDate: "2026-11-30",
        installmentNumber: 12,
        status: "planned",
      },
    ]);
  });

  it("clamps future occurrences to the last valid day of each month", () => {
    expect(
      buildActiveInstallmentSchedule({
        amount: 463,
        amountMode: "per_installment",
        currentInstallment: 3,
        currentOccurrenceDate: "2026-01-31",
        installmentCount: 6,
      }).map(({ dueDate, installmentNumber }) => ({
        dueDate,
        installmentNumber,
      })),
    ).toEqual([
      { dueDate: "2026-01-31", installmentNumber: 3 },
      { dueDate: "2026-02-28", installmentNumber: 4 },
      { dueDate: "2026-03-31", installmentNumber: 5 },
      { dueDate: "2026-04-30", installmentNumber: 6 },
    ]);
  });
});
