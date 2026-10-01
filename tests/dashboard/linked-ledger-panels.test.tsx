import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AccountTransfersPanel } from "@/components/dashboard/account-transfers-panel";
import { ReimbursementDialog } from "@/components/dashboard/reimbursement-dialog";
import type { Transaction } from "@/lib/data";
import type { AccountTransfer } from "@/lib/finance/transactions";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    formatCurrency: (value: number) => `RM${value.toFixed(2)}`,
    t: (key: string) => key,
  }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    onValueChange,
    value,
  }: {
    children: ReactNode;
    onValueChange: (value: string) => void;
    value: string;
  }) => (
    <select
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">Select</option>
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
}));

const paymentMethods = [
  { id: "source", label: "Source account", type: "debit" as const },
  { id: "destination", label: "Destination account", type: "cash" as const },
  { id: "credit", label: "Credit card", type: "credit" as const },
];

function transfer(deletedAt: string | null, id: string): AccountTransfer {
  return {
    amount: 175,
    createdAt: "2026-09-30T00:00:00Z",
    deletedAt,
    description: `Transfer ${id}`,
    destinationAccountId: "destination",
    id,
    idempotencyKey: `${id}-key`,
    notes: null,
    revision: deletedAt ? 2 : 1,
    sourceAccountId: "source",
    transferDate: "2026-09-30",
    updatedAt: "2026-09-30T00:00:00Z",
  };
}

describe("linked ledger panels", () => {
  it("creates and manages account transfers without offering credit accounts", async () => {
    const user = userEvent.setup();
    const createAction = vi
      .fn()
      .mockResolvedValue({ revision: 1, transferId: "new" });
    const deleteAction = vi.fn().mockResolvedValue(2);
    const restoreAction = vi.fn().mockResolvedValue(3);
    const updateAction = vi.fn().mockResolvedValue(2);
    render(
      <AccountTransfersPanel
        createAction={createAction}
        deleteAction={deleteAction}
        paymentMethods={paymentMethods}
        restoreAction={restoreAction}
        transfers={[
          transfer(null, "active"),
          transfer("2026-09-30", "deleted"),
        ]}
        updateAction={updateAction}
      />,
    );

    expect(screen.queryByText("Credit card")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "transfers.add" }));
    const accounts = screen.getAllByRole("combobox");
    fireEvent.change(accounts[0], { target: { value: "source" } });
    fireEvent.change(accounts[1], { target: { value: "destination" } });
    await user.type(screen.getByLabelText("transaction.amount"), "175");
    await user.type(
      screen.getByLabelText("transaction.description"),
      "Move funds",
    );
    await user.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(createAction).toHaveBeenCalledOnce());

    await user.click(screen.getByRole("button", { name: "common.edit" }));
    fireEvent.change(screen.getByLabelText("transaction.notes"), {
      target: { value: "Updated note" },
    });
    await user.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() =>
      expect(updateAction).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedRevision: 1,
          id: "active",
          notes: "Updated note",
        }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "common.delete" }));
    await user.click(screen.getByRole("button", { name: "transfers.restore" }));
    await waitFor(() => expect(deleteAction).toHaveBeenCalledOnce());
    expect(restoreAction).toHaveBeenCalledOnce();
  });

  it("links a reimbursement to an expense and receiving account", async () => {
    const user = userEvent.setup();
    const createAction = vi
      .fn()
      .mockResolvedValue({ transactionId: "receipt" });
    const expense: Transaction = {
      amount: -83.4,
      categoryKey: "Meals",
      date: "2026-09-30",
      descriptionKey: "Shared order",
      group: "needs",
      icon: "meal",
      id: "expense",
      type: "expense",
    };
    const excluded: Transaction[] = [
      { ...expense, entryKind: "repayment", id: "repayment" },
      { ...expense, entryKind: "transfer", id: "transfer" },
      { ...expense, id: "invoice", isCreditCardInvoice: true },
      { ...expense, id: "income", type: "income" },
    ];
    render(
      <ReimbursementDialog
        createAction={createAction}
        paymentMethods={paymentMethods}
        transactions={[expense, ...excluded]}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "reimbursements.add" }),
    );
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "expense" } });
    fireEvent.change(selects[1], { target: { value: "destination" } });
    await user.type(screen.getByLabelText("transaction.amount"), "50.60");
    fireEvent.change(screen.getByLabelText("transaction.date"), {
      target: { value: "2026-10-01" },
    });
    await user.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() =>
      expect(createAction).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 50.6,
          date: "2026-10-01",
          originalTransactionId: "expense",
          paymentMethod: "destination",
        }),
      ),
    );
  });
});
