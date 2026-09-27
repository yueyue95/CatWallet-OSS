import { describe, expect, it } from "vitest";

import {
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

  it("uses cents without drift for RM269.33 x 12", () => {
    const result = plan(269.33, 12, "per_installment", 9);
    expect(result.totalAmount).toBeCloseTo(3231.96, 2);
    expect(result.remainingAmount).toBeCloseTo(807.99, 2);
    expect(result.installmentAmounts).toHaveLength(12);
    result.installmentAmounts.forEach((amount) =>
      expect(amount).toBeCloseTo(269.33, 2),
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
