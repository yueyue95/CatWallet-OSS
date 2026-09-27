import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CoolingScreen } from "@/components/catwallet/cooling-screen";
import zhCNMessages from "@/lib/i18n/zh-CN";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    formatCurrency: (value: number) => `RM ${value.toFixed(2)}`,
    t: (key: string) => zhCNMessages[key] ?? key,
  }),
}));

const now = "2026-09-17T00:00:00.000Z";

describe("cooling screen", () => {
  it("adds a minimal cooling item and renders the live cooling state", () => {
    const createAction = vi.fn().mockResolvedValue(undefined);
    render(
      <CoolingScreen
        createAction={createAction}
        items={[]}
        abandonAction={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "Canon 打印机" },
    });
    fireEvent.change(screen.getByLabelText("金额"), {
      target: { value: "800" },
    });
    fireEvent.click(screen.getByRole("button", { name: "加入想买清单" }));

    expect(createAction).toHaveBeenCalledWith({
      amountCents: 80_000,
      coolingDays: 7,
      name: "Canon 打印机",
      notes: null,
      url: null,
    });
  });

  it("shows purchase and abandon actions without changing transaction data itself", () => {
    const abandonAction = vi.fn().mockResolvedValue(undefined);
    render(
      <CoolingScreen
        abandonAction={abandonAction}
        createAction={vi.fn()}
        items={[
          {
            addedAt: now,
            amountCents: 80_000,
            coolingDays: 0,
            createdAt: now,
            id: "item-1",
            name: "Canon 打印机",
            notes: null,
            purchasedTransactionId: null,
            status: "ready",
            updatedAt: now,
            url: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("可以决定了 😼")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "我还是想买" })).toHaveAttribute(
      "href",
      "/transactions/new?coolingItem=item-1",
    );
    fireEvent.click(screen.getByRole("button", { name: "算了，不买" }));
    expect(abandonAction).toHaveBeenCalledWith("item-1");
  });
});
