import { describe, expect, it } from "vitest";

import {
  accountTransferLifecycleSchema,
  createAccountTransferSchema,
  createInstallmentSchema,
  createReimbursementSchema,
  listTransactionsSchema,
  monthlyBudgetSchema,
  optionalDateSchema,
  previewTransactionImportSchema,
  previewAccountTransferSchema,
  updateTransactionSchema,
  updateAccountTransferSchema,
} from "@/mcp/schemas";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const DESTINATION_ID = "22222222-2222-4222-8222-222222222222";
const ENTITY_ID = "33333333-3333-4333-8333-333333333333";

describe("ledger operation MCP schemas", () => {
  const transfer = {
    amount: 175,
    date: "2026-09-30",
    description: "Synthetic transfer",
    destinationAccountId: DESTINATION_ID,
    sourceAccountId: SOURCE_ID,
  };

  it("accepts the full transfer lifecycle contract", () => {
    expect(
      previewAccountTransferSchema.parse({
        ...transfer,
        expectedRevision: 2,
        id: ENTITY_ID,
      }),
    ).toMatchObject({ id: ENTITY_ID });
    expect(
      createAccountTransferSchema.parse({
        ...transfer,
        idempotencyKey: "transfer-create",
      }),
    ).toMatchObject({ amount: 175 });
    expect(
      updateAccountTransferSchema.parse({
        ...transfer,
        expectedRevision: 2,
        id: ENTITY_ID,
        idempotencyKey: "transfer-update",
      }),
    ).toMatchObject({ expectedRevision: 2 });
    expect(
      accountTransferLifecycleSchema.parse({
        expectedRevision: 2,
        id: ENTITY_ID,
        idempotencyKey: "transfer-delete",
      }),
    ).toMatchObject({ id: ENTITY_ID });
  });

  it("accepts reimbursement linkage and installment commitment conversion", () => {
    expect(
      createReimbursementSchema.parse({
        amount: 20.1,
        date: "2026-09-30",
        description: "Synthetic reimbursement",
        idempotencyKey: "reimbursement-create",
        originalTransactionId: ENTITY_ID,
        paymentAccountId: DESTINATION_ID,
      }),
    ).toMatchObject({ originalTransactionId: ENTITY_ID });
    expect(
      createInstallmentSchema.parse({
        amount: 137,
        amountMode: "per_installment",
        categoryId: ENTITY_ID,
        currentInstallment: 10,
        date: "2026-09-30",
        description: "Synthetic installment",
        fixedCommitmentId: SOURCE_ID,
        idempotencyKey: "installment-create",
        paymentAccountId: DESTINATION_ID,
        totalInstallments: 12,
      }),
    ).toMatchObject({ fixedCommitmentId: SOURCE_ID });
  });

  it("rejects a transfer back into the same account at preview time", () => {
    expect(
      previewAccountTransferSchema.safeParse({
        ...transfer,
        destinationAccountId: SOURCE_ID,
      }).success,
    ).toBe(false);
  });

  it("rejects contradictory transaction filters and impossible dates", () => {
    expect(optionalDateSchema.safeParse({ date: "2026-02-30" }).success).toBe(
      false,
    );
    expect(
      listTransactionsSchema.safeParse({
        from: "2026-09-01",
        month: "2026-09",
      }).success,
    ).toBe(false);
    expect(
      listTransactionsSchema.safeParse({
        from: "2026-09-30",
        to: "2026-09-01",
      }).success,
    ).toBe(false);
  });

  it("enforces transaction and budget cross-field rules", () => {
    const transaction = {
      amount: 10,
      categoryId: ENTITY_ID,
      countsTowardFunMoney: true,
      date: "2026-09-30",
      description: "Invalid income",
      id: SOURCE_ID,
      idempotencyKey: "update-transaction",
      paymentAccountId: DESTINATION_ID,
      type: "income",
    };
    expect(updateTransactionSchema.safeParse(transaction).success).toBe(false);
    expect(
      updateTransactionSchema.safeParse({
        ...transaction,
        categoryId: null,
        countsTowardFunMoney: false,
      }).success,
    ).toBe(true);
    expect(
      monthlyBudgetSchema.safeParse({
        idempotencyKey: "budget",
        month: "2026-09",
      }).success,
    ).toBe(false);
    for (const limit of ["needsLimit", "wantsLimit", "savingsLimit"] as const) {
      expect(
        monthlyBudgetSchema.safeParse({
          idempotencyKey: `budget-${limit}`,
          month: "2026-09",
          [limit]: 100,
        }).success,
      ).toBe(true);
    }
  });

  it("rejects invalid installment progress and import ownership semantics", () => {
    const installment = {
      amount: 0.02,
      amountMode: "total" as const,
      categoryId: ENTITY_ID,
      currentInstallment: 3,
      date: "2026-09-30",
      description: "Invalid installment",
      idempotencyKey: "installment-invalid",
      paymentAccountId: DESTINATION_ID,
      totalInstallments: 2,
    };
    expect(createInstallmentSchema.safeParse(installment).success).toBe(false);
    expect(
      createInstallmentSchema.safeParse({
        ...installment,
        amount: 0.01,
        currentInstallment: 1,
      }).success,
    ).toBe(false);
    expect(
      previewTransactionImportSchema.safeParse({
        rows: [
          {
            amount: 10,
            categoryId: ENTITY_ID,
            date: "2026-09-30",
            description: "Income with category",
            idempotencyKey: ENTITY_ID,
            paymentAccountId: DESTINATION_ID,
            type: "income",
          },
        ],
      }).success,
    ).toBe(false);
  });
});
