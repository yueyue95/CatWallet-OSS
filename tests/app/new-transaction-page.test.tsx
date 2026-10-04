import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getTransactionFormOptions: vi.fn().mockResolvedValue({
    categories: [],
    paymentMethods: [],
  }),
  getUserContext: vi.fn().mockResolvedValue({ userId: "user-a" }),
  listTransactions: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/finance/transactions", () => ({
  getTransactionFormOptions: mocks.getTransactionFormOptions,
  getUserContext: mocks.getUserContext,
  listTransactions: mocks.listTransactions,
}));
vi.mock("@/lib/finance/cooling", () => ({ getCoolingItem: vi.fn() }));
vi.mock("@/lib/finance/catwallet", () => ({
  listFixedCommitments: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/components/dashboard/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/dashboard/transaction-form", () => ({
  TransactionForm: () => <div>Transaction form</div>,
}));
vi.mock("@/components/dashboard/reimbursement-dialog", () => ({
  ReimbursementDialog: () => <button>Reimbursement form</button>,
}));

import NewTransactionPage from "@/app/transactions/new/page";

describe("NewTransactionPage", () => {
  it("offers the first-class reimbursement entry with searchable expenses", async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getClaims: vi
          .fn()
          .mockResolvedValue({ data: { claims: { sub: "user-a" } } }),
      },
    });

    render(await NewTransactionPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Transaction form")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reimbursement form" }),
    ).toBeInTheDocument();
    expect(mocks.listTransactions).toHaveBeenCalledWith(
      expect.objectContaining({
        includePrevious: true,
        userContext: { userId: "user-a" },
      }),
    );
  });
});
