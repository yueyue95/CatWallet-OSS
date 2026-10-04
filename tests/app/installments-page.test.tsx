import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInstallmentOverview: vi.fn().mockResolvedValue([]),
  getTransactionFormOptions: vi.fn().mockResolvedValue({ categories: [] }),
  getUserContext: vi.fn().mockResolvedValue({ userId: "user-a" }),
  listSinkingFunds: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/app/catwallet/actions", () => ({
  saveInstallmentRetirementAllocationAction: vi.fn(),
}));
vi.mock("@/app/transactions/actions", () => ({
  deleteInstallmentAction: vi.fn(),
  previewDeleteInstallmentAction: vi.fn(),
  restoreInstallmentAction: vi.fn(),
}));
vi.mock("@/components/dashboard/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/catwallet/installments-screen", () => ({
  InstallmentsScreen: ({ view }: { view?: string }) => (
    <div>Installments screen {view}</div>
  ),
}));
vi.mock("@/lib/finance/catwallet", () => ({
  getInstallmentOverview: mocks.getInstallmentOverview,
  listSinkingFunds: mocks.listSinkingFunds,
}));
vi.mock("@/lib/finance/transactions", () => ({
  getTransactionFormOptions: mocks.getTransactionFormOptions,
  getUserContext: mocks.getUserContext,
}));

import InstallmentsPage from "@/app/installments/page";

describe("InstallmentsPage", () => {
  it("loads only active installment plans for the normal page", async () => {
    render(await InstallmentsPage());

    expect(screen.getByText("Installments screen active")).toBeInTheDocument();
    expect(mocks.getInstallmentOverview).toHaveBeenCalledWith({
      userId: "user-a",
    });
  });

  it("loads soft-deleted installment plans only for the explicit deleted view", async () => {
    render(
      await InstallmentsPage({
        searchParams: Promise.resolve({ view: "deleted" }),
      }),
    );

    expect(screen.getByText("Installments screen deleted")).toBeInTheDocument();
    expect(mocks.getInstallmentOverview).toHaveBeenCalledWith(
      { userId: "user-a" },
      { includeDeleted: true },
    );
  });
});
