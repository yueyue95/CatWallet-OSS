import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FunMoneyScreen } from "@/components/catwallet/fun-money-screen";
import zhCNMessages from "@/lib/i18n/zh-CN";

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    formatCurrency: (value: number) => `RM ${value.toFixed(2)}`,
    t: (key: string) => zhCNMessages[key] ?? key,
  }),
}));

describe("fun money screen", () => {
  it("shows the monthly allowance and saves a new amount", async () => {
    const saveBudgetAction = vi.fn().mockResolvedValue(undefined);

    render(
      <FunMoneyScreen
        overview={{
          budget: 500,
          budgetSet: true,
          isOverBudget: false,
          month: "2026-09",
          overAmount: 0,
          percentage: 25,
          remaining: 375,
          spent: 125,
        }}
        saveBudgetAction={saveBudgetAction}
      />,
    );

    expect(screen.getByRole("heading", { name: "快乐钱" })).toBeInTheDocument();
    expect(screen.getByText("RM 375.00")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("每月额度"), {
      target: { value: "600" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存额度" }));

    expect(saveBudgetAction).toHaveBeenCalledWith({
      amount: 600,
      month: "2026-09",
    });
    expect(screen.getByRole("link", { name: "记一笔支出" })).toHaveAttribute(
      "href",
      "/transactions/new?funMoney=1",
    );
  });
});
