import { describe, expect, it } from "vitest";

import {
  clearFunMoneyBudgetSchema,
  clearMonthlyBudgetSchema,
  createInstallmentSchema,
  createPaymentAccountSchema,
  createTransactionSchema,
  installmentPaymentSchema,
  importTransactionsSchema,
  updateInstallmentSchema,
} from "@/mcp/schemas";
import { getCapabilities } from "@/mcp/capabilities";

const CATEGORY_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";

describe("CatWallet Butler capability contracts", () => {
  it("publishes all requested financial writes as idempotent and no auth writes", () => {
    const capabilities = getCapabilities();
    const writeNames = new Set(capabilities.writes.map((item) => item.name));

    expect(writeNames).toEqual(
      new Set([
        "create_transaction",
        "update_transaction",
        "delete_transaction",
        "restore_transaction",
        "create_payment_account",
        "update_payment_account",
        "set_opening_balance",
        "add_balance_adjustment",
        "delete_payment_account",
        "create_category",
        "update_category",
        "archive_category",
        "delete_category",
        "create_fixed_commitment",
        "update_fixed_commitment",
        "disable_fixed_commitment",
        "record_fixed_commitment_payment",
        "create_installment",
        "update_installment",
        "record_installment_payment",
        "complete_installment",
        "create_sinking_fund",
        "update_sinking_fund",
        "archive_sinking_fund",
        "record_sinking_fund_entry",
        "create_goal",
        "update_goal",
        "delete_goal",
        "record_goal_fund_entry",
        "create_cooling_item",
        "update_cooling_item",
        "set_cooling_item_status",
        "delete_cooling_item",
        "set_monthly_budget",
        "clear_monthly_budget",
        "set_fun_money_budget",
        "clear_fun_money_budget",
        "import_transactions",
        "undo_transaction_import",
        "restore_transaction_import",
      ]),
    );
    expect(capabilities.userIdParameterAllowed).toBe(false);
    expect(capabilities.writes.every((item) => item.idempotencyRequired)).toBe(
      true,
    );
    expect(capabilities.restricted.map((item) => item.name)).toContain(
      "password_or_auth_mutation",
    );
  });

  it("accepts explicit account/installment/budget inputs and rejects user selectors", () => {
    expect(
      createPaymentAccountSchema.parse({
        balanceTrackingEnabled: true,
        idempotencyKey: "account-key",
        name: "银行账户",
        type: "bank",
      }),
    ).toMatchObject({ type: "bank" });

    expect(
      createInstallmentSchema.parse({
        amount: 269.33,
        amountMode: "per_installment",
        categoryId: CATEGORY_ID,
        currentInstallment: 9,
        date: "2026-09-01",
        description: "保险分期",
        idempotencyKey: "installment-key",
        paymentAccountId: ACCOUNT_ID,
        totalInstallments: 12,
      }),
    ).toMatchObject({ currentInstallment: 9, totalInstallments: 12 });

    for (const [amount, amountMode] of [
      [0.01, "per_installment"],
      [1, "total"],
    ] as const) {
      expect(
        createInstallmentSchema.parse({
          amount,
          amountMode,
          categoryId: CATEGORY_ID,
          currentInstallment: 1,
          date: "2026-09-26",
          description: "Two-period installment",
          idempotencyKey: `installment-${amountMode}`,
          paymentAccountId: ACCOUNT_ID,
          totalInstallments: 2,
        }),
      ).toMatchObject({ amount, amountMode, totalInstallments: 2 });
    }

    expect(
      updateInstallmentSchema.parse({
        amount: 269.33,
        categoryId: CATEGORY_ID,
        date: "2026-09-01",
        description: "保险分期",
        idempotencyKey: "installment-update-key",
        installmentId: ACCOUNT_ID,
        paymentAccountId: ACCOUNT_ID,
      }),
    ).toHaveProperty("installmentId", ACCOUNT_ID);

    expect(
      installmentPaymentSchema.parse({
        idempotencyKey: "payment-key",
        targetMonth: "2026-09",
        transactionId: ACCOUNT_ID,
      }),
    ).toHaveProperty("targetMonth", "2026-09");

    expect(
      clearMonthlyBudgetSchema.parse({
        idempotencyKey: "clear-budget-key",
        month: "2026-09",
      }),
    ).toEqual({ idempotencyKey: "clear-budget-key", month: "2026-09" });
    expect(
      clearFunMoneyBudgetSchema.parse({
        idempotencyKey: "clear-fun-key",
        month: "2026-09",
      }),
    ).toEqual({ idempotencyKey: "clear-fun-key", month: "2026-09" });
  });

  it("rejects userId and invalid import rows at the schema boundary", () => {
    expect(() =>
      createTransactionSchema.parse({ userId: ACCOUNT_ID }),
    ).toThrow();
    expect(() =>
      importTransactionsSchema.parse({
        batchIdempotencyKey: "batch-key",
        rows: [
          {
            amount: 1,
            categoryId: CATEGORY_ID,
            date: "2026-09-31",
            description: "invalid date",
            idempotencyKey: ACCOUNT_ID,
            paymentAccountId: ACCOUNT_ID,
            type: "expense",
          },
        ],
      }),
    ).toThrow();
  });

  it("reports a precise amount field error and documents import UUID keys", () => {
    const invalidInstallment = createInstallmentSchema.safeParse({
      amount: 0.001,
      amountMode: "per_installment",
      categoryId: CATEGORY_ID,
      currentInstallment: 1,
      date: "2026-09-26",
      description: "Invalid sub-cent amount",
      idempotencyKey: "installment-invalid-amount",
      paymentAccountId: ACCOUNT_ID,
      totalInstallments: 2,
    });

    expect(invalidInstallment.success).toBe(false);
    if (!invalidInstallment.success) {
      expect(invalidInstallment.error.issues).toContainEqual(
        expect.objectContaining({ path: ["amount"] }),
      );
    }

    const invalidImport = importTransactionsSchema.safeParse({
      batchIdempotencyKey: "batch-key",
      rows: [
        {
          amount: 1,
          categoryId: CATEGORY_ID,
          date: "2026-09-26",
          description: "Invalid key",
          idempotencyKey: "ordinary-string",
          paymentAccountId: ACCOUNT_ID,
          type: "expense",
        },
      ],
    });
    expect(invalidImport.success).toBe(false);
    if (!invalidImport.success) {
      expect(invalidImport.error.issues).toContainEqual(
        expect.objectContaining({
          message: "idempotencyKey must be a UUID",
          path: ["rows", 0, "idempotencyKey"],
        }),
      );
    }
  });

  it("requires owner-scoped identifiers for destructive-but-safe cleanup", async () => {
    const { deleteCategorySchema, deleteCoolingItemSchema } =
      await import("@/mcp/schemas");

    expect(
      deleteCategorySchema.parse({
        id: CATEGORY_ID,
        idempotencyKey: "category-delete-key",
      }),
    ).toMatchObject({ id: CATEGORY_ID });
    expect(
      deleteCoolingItemSchema.parse({
        id: ACCOUNT_ID,
        idempotencyKey: "cooling-delete-key",
      }),
    ).toMatchObject({ id: ACCOUNT_ID });
  });
});
