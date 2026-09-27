import { renderToStaticMarkup } from "react-dom/server";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { GoalsScreen } from "@/components/dashboard/goals-screen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    formatCurrency: (value: number) => `RM${value.toFixed(2)}`,
    t: (key: string) => key,
  }),
}));

describe("GoalsScreen accessibility", () => {
  it("gives the goal actions menu an accessible name", () => {
    const markup = renderToStaticMarkup(
      <GoalsScreen
        addGoalFundsAction={vi.fn()}
        createGoalAction={vi.fn()}
        deleteGoalAction={vi.fn()}
        goals={[
          {
            color: "#22c55e",
            currentAmount: 1,
            deadline: "2027-09-26",
            icon: "🎯",
            id: "goal-1",
            name: "Emergency fund",
            targetAmount: 1000,
          },
        ]}
        updateGoalAction={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="common.moreActions: Emergency fund"');
  });

  it("keeps the saved balance read-only while allowing target edits", async () => {
    const user = userEvent.setup();
    render(
      <GoalsScreen
        addGoalFundsAction={vi.fn()}
        createGoalAction={vi.fn()}
        deleteGoalAction={vi.fn()}
        goals={[
          {
            color: "#22c55e",
            currentAmount: 1,
            deadline: "2027-09-26",
            icon: "🎯",
            id: "goal-1",
            name: "Emergency fund",
            targetAmount: 1000,
          },
        ]}
        updateGoalAction={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /common.moreActions/ }),
    );
    await user.click(screen.getByRole("menuitem", { name: "common.edit" }));

    expect(screen.getByLabelText("goals.targetAmount")).toBeInTheDocument();
    expect(screen.queryByLabelText("goals.currentAmount")).toBeNull();
  });
});
