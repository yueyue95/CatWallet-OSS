import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PaymentMethodsTab } from "@/components/dashboard/payment-methods-tab";
import type { PaymentMethodOverviewItem } from "@/lib/finance/transactions";

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    formatCurrency: (value: number) => `RM${value.toFixed(2)}`,
    t: (key: string) => key,
  }),
}));

describe("PaymentMethodsTab credit limit summary", () => {
  it("subtracts current card liability instead of selected-month spending", () => {
    const card = {
      balanceTrackingEnabled: true,
      canModify: true,
      closingDay: 7,
      creditLimit: 9000,
      currentLiability: 1248.75,
      detail: {
        paymentMethodId: "card-1",
        paymentMethodName: "Demo Visa",
        paymentMethodType: "credit",
        selectedMonth: "2026-09",
        totalAmount: 0,
        transactions: [],
      },
      dueDay: 14,
      id: "card-1",
      isDefault: false,
      label: "Demo Visa",
      name: "Demo Visa",
      spent: 0,
      type: "credit",
    } satisfies PaymentMethodOverviewItem;
    const markup = renderToStaticMarkup(
      <PaymentMethodsTab
        onDeletePaymentMethod={vi.fn()}
        onEditPaymentMethod={vi.fn()}
        onViewPaymentMethod={vi.fn()}
        paymentMethods={[card]}
      />,
    );

    expect(markup).toContain("RM7751.25");
  });
});
