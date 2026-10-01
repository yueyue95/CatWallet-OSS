"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  advanceInstallments,
  createAccountTransferWithResult,
  createCategory,
  createInvoiceAdvancePayment,
  createPaymentMethod,
  createReimbursementWithResult,
  createSubscription,
  createTransaction,
  deleteCategory,
  deleteAccountTransfer,
  deleteInstallment,
  deleteInstallments,
  deletePaymentMethod,
  deleteSubscription,
  deleteSubscriptionOccurrences,
  deleteTransaction,
  previewInstallmentPrepayment,
  previewDeleteInstallment,
  restoreInstallment,
  restoreAccountTransfer,
  setSubscriptionPaused,
  type CreateCategoryInput,
  type CreateAccountTransferInput,
  type CreateInvoiceAdvancePaymentInput,
  type CreatePaymentMethodInput,
  type CreateReimbursementInput,
  type CreateSubscriptionInput,
  type AdvanceInstallmentsInput,
  type DeleteInstallmentsInput,
  type DeleteSubscriptionOccurrencesInput,
  type NewTransactionInput,
  type UpdateCategoryInput,
  type UpdateAccountTransferInput,
  type UpdatePaymentMethodInput,
  type UpdateSubscriptionInput,
  updateCategory,
  updateAccountTransfer,
  updatePaymentMethod,
  updateSubscription,
  updateTransaction,
  type UpdateTransactionInput,
} from "@/lib/finance/transactions";
import { markCoolingItemPurchased } from "@/lib/finance/cooling";
import {
  addAccountBalanceAdjustment,
  setAccountOpeningBalance,
} from "@/lib/finance/account-balances";
import type { CreateTransactionResult } from "@/lib/finance/transaction-result";

const uuidSchema = z
  .string()
  .trim()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "Invalid UUID",
  );

const safeShortTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: "Invalid control characters",
  });

const safeOptionalNotesSchema = z
  .string()
  .trim()
  .max(500)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: "Invalid control characters",
  })
  .optional();

const dateSchema = z
  .string()
  .trim()
  .regex(/^(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})$/, "Invalid date");

const createCategoryActionSchema = z
  .object({
    group: z.enum(["needs", "wants", "savings"]),
    icon: z.string().trim().max(32),
    monthlyLimit: z.number().finite().min(0).max(1_000_000_000).optional(),
    name: safeShortTextSchema,
  })
  .strict();

const createTransactionActionSchema = z
  .object({
    amount: z.number().finite().positive().max(1_000_000_000),
    category: z.string().trim().min(0).max(64),
    countsTowardFunMoney: z.boolean().optional(),
    coolingItemId: uuidSchema.optional(),
    date: dateSchema,
    description: safeShortTextSchema,
    existingTransactionId: uuidSchema.optional(),
    fixedCommitmentId: uuidSchema.optional(),
    installmentCount: z.number().int().min(1).max(120),
    installmentAmountMode: z.enum(["per_installment", "total"]).optional(),
    currentInstallment: z.number().int().min(1).max(120).optional(),
    notes: safeOptionalNotesSchema,
    paymentMethod: z.string().trim().min(0).max(64),
    type: z.enum(["income", "expense", "saving"]),
    idempotencyKey: uuidSchema.optional(),
  })
  .strict();

const createSubscriptionActionSchema = z
  .object({
    amount: z.number().finite().positive().max(1_000_000_000),
    category: z.string().trim().min(0).max(64),
    description: safeShortTextSchema,
    nextDate: dateSchema,
    paymentMethod: z.string().trim().min(0).max(64),
  })
  .strict();

const updateSubscriptionActionSchema = createSubscriptionActionSchema
  .extend({
    id: uuidSchema,
  })
  .strict();

const updateCategoryActionSchema = createCategoryActionSchema
  .extend({
    id: uuidSchema,
  })
  .strict();

const updatePaymentMethodActionSchema = z
  .object({
    balanceTrackingEnabled: z.boolean().optional(),
    creditLimit: z.number().finite().min(0).max(1_000_000_000).optional(),
    closingDay: z.number().int().min(1).max(31).nullable().optional(),
    dueDay: z.number().int().min(1).max(31).nullable().optional(),
    id: uuidSchema,
    name: safeShortTextSchema,
    type: z.enum(["bank", "boleto", "credit", "debit", "ewallet", "other"]),
  })
  .strict();

const createPaymentMethodActionSchema = updatePaymentMethodActionSchema
  .omit({ id: true })
  .strict();

const createInvoiceAdvancePaymentActionSchema = z
  .object({
    amount: z.number().finite().positive().max(1_000_000_000),
    date: dateSchema,
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
    invoiceId: z
      .string()
      .trim()
      .regex(
        /^credit-card-invoice:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:\d{4}-\d{2}$/i,
        "Invalid invoice",
      ),
    paymentMethod: z.string().trim().min(0).max(64),
  })
  .strict();

const moneyInputSchema = z.union([
  z.number().finite(),
  z
    .string()
    .trim()
    .regex(/^-?\d+(?:\.\d{1,2})?$/),
]);

const accountBalanceActionSchema = z
  .object({
    amount: moneyInputSchema,
    effectiveDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
    paymentMethodId: uuidSchema,
  })
  .strict();

const accountBalanceAdjustmentActionSchema = accountBalanceActionSchema
  .extend({
    note: safeOptionalNotesSchema,
  })
  .strict();

const accountTransferActionSchema = z
  .object({
    amount: z.number().finite().positive().max(1_000_000_000),
    date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
    description: safeShortTextSchema,
    destinationAccountId: uuidSchema,
    notes: safeOptionalNotesSchema,
    sourceAccountId: uuidSchema,
  })
  .strict()
  .refine((value) => value.sourceAccountId !== value.destinationAccountId, {
    message: "Source and destination accounts must differ",
    path: ["destinationAccountId"],
  });

const createAccountTransferActionSchema = accountTransferActionSchema.and(
  z.object({ idempotencyKey: uuidSchema.optional() }).strict(),
);

const updateAccountTransferActionSchema = accountTransferActionSchema.and(
  z
    .object({ expectedRevision: z.number().int().positive(), id: uuidSchema })
    .strict(),
);

const accountTransferLifecycleActionSchema = z
  .object({ expectedRevision: z.number().int().positive(), id: uuidSchema })
  .strict();

const reimbursementActionSchema = z
  .object({
    amount: z.number().finite().positive().max(1_000_000_000),
    date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
    description: safeShortTextSchema,
    idempotencyKey: uuidSchema.optional(),
    notes: safeOptionalNotesSchema,
    originalTransactionId: uuidSchema,
    paymentMethod: uuidSchema,
  })
  .strict();

const updateTransactionActionSchema = z
  .object({
    amount: z.number().finite().positive().max(1_000_000_000),
    category: z.string().trim().min(0).max(64),
    countsTowardFunMoney: z.boolean().optional(),
    date: dateSchema,
    description: safeShortTextSchema,
    id: uuidSchema,
    notes: safeOptionalNotesSchema,
    paymentMethod: z.string().trim().min(0).max(64),
    type: z.enum(["expense", "income", "saving"]),
  })
  .strict();

const deleteInstallmentsActionSchema = z
  .object({
    scope: z.enum(["single", "this_and_following", "all"]),
    transactionId: uuidSchema,
  })
  .strict();

const installmentPlanActionSchema = z.object({ planId: uuidSchema }).strict();

const advanceInstallmentsActionSchema = z
  .object({
    scope: z.enum(["remaining", "selected_and_remaining"]).optional(),
    targetMonth: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}$/, "Invalid month"),
    transactionId: uuidSchema,
  })
  .strict();

const deleteSubscriptionOccurrencesActionSchema = z
  .object({
    scope: z.enum(["single", "this_and_following_unpaid"]),
    transactionId: uuidSchema,
  })
  .strict();

export async function createCategoryAction(data: CreateCategoryInput) {
  const parsed = createCategoryActionSchema.parse(data);

  await createCategory(parsed);

  revalidatePath("/categories");
  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  revalidatePath("/transactions/new");
}

export async function updateCategoryAction(data: UpdateCategoryInput) {
  const parsed = updateCategoryActionSchema.parse(data);

  await updateCategory(parsed);

  revalidatePath("/categories");
  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  revalidatePath("/transactions/new");
}

export async function deleteCategoryAction(categoryId: string) {
  const parsedCategoryId = uuidSchema.parse(categoryId);

  await deleteCategory(parsedCategoryId);

  revalidatePath("/categories");
  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  revalidatePath("/transactions/new");
}

function errorFields(error: unknown, errorMessage: string) {
  return error instanceof Error
    ? { error_code: error.name, error_message: errorMessage }
    : { error_code: "UnknownError", error_message: errorMessage };
}

function logCreateEvent(
  event: string,
  fields: Record<string, unknown> = {},
  level: "info" | "error" = "info",
) {
  console[level](JSON.stringify({ event, ...fields }));
}

function revalidateCreatedTransaction(transactionId: string) {
  try {
    for (const path of [
      "/cooling",
      "/dashboard",
      "/reports",
      "/transactions",
      "/transactions/new",
    ]) {
      revalidatePath(path);
    }
    logCreateEvent("REVALIDATE_SUCCESS", { transaction_id: transactionId });
    return [];
  } catch (error) {
    logCreateEvent(
      "REVALIDATE_FAIL",
      {
        transaction_id: transactionId,
        ...errorFields(error, "Path revalidation failed"),
      },
      "error",
    );
    return ["revalidate" as const];
  }
}

export async function createTransactionAction(
  data: NewTransactionInput,
): Promise<CreateTransactionResult> {
  logCreateEvent("START_CREATE");
  try {
    const parsed = createTransactionActionSchema.parse(data);
    const { coolingItemId, ...transactionData } = parsed;
    const transactionId = await createTransaction({
      ...transactionData,
      category: parsed.category || "none",
      paymentMethod: parsed.paymentMethod || "none",
    });

    const warnings = [] as Array<"cooling_link" | "revalidate">;
    if (coolingItemId) {
      try {
        await markCoolingItemPurchased(coolingItemId, transactionId);
        logCreateEvent("POST_PROCESS_SUCCESS", {
          transaction_id: transactionId,
          cooling_item_id: coolingItemId,
        });
      } catch (error) {
        warnings.push("cooling_link");
        logCreateEvent(
          "POST_PROCESS_FAIL",
          {
            transaction_id: transactionId,
            cooling_item_id: coolingItemId,
            ...errorFields(error, "Cooling item link failed"),
          },
          "error",
        );
      }
    } else {
      logCreateEvent("POST_PROCESS_SUCCESS", { transaction_id: transactionId });
    }

    warnings.push(...revalidateCreatedTransaction(transactionId));

    const result: CreateTransactionResult = {
      ok: true,
      transactionId,
      ...(warnings.length ? { warnings } : {}),
    };
    logCreateEvent("ACTION_RETURN_SUCCESS", {
      transaction_id: transactionId,
      warning_count: warnings.length,
    });
    return result;
  } catch (error) {
    logCreateEvent(
      "ACTION_RETURN_FAIL",
      errorFields(error, "Transaction creation failed"),
      "error",
    );
    throw error;
  }
}

function revalidateAccountTransferPaths() {
  for (const path of ["/dashboard", "/reports", "/transactions"]) {
    revalidatePath(path);
  }
}

export async function createAccountTransferAction(
  data: CreateAccountTransferInput,
) {
  const result = await createAccountTransferWithResult(
    createAccountTransferActionSchema.parse(data),
  );
  revalidateAccountTransferPaths();
  return result;
}

export async function updateAccountTransferAction(
  data: UpdateAccountTransferInput,
) {
  const revision = await updateAccountTransfer(
    updateAccountTransferActionSchema.parse(data),
  );
  revalidateAccountTransferPaths();
  return revision;
}

export async function deleteAccountTransferAction(data: {
  expectedRevision: number;
  id: string;
}) {
  const parsed = accountTransferLifecycleActionSchema.parse(data);
  const revision = await deleteAccountTransfer(
    parsed.id,
    parsed.expectedRevision,
  );
  revalidateAccountTransferPaths();
  return revision;
}

export async function restoreAccountTransferAction(data: {
  expectedRevision: number;
  id: string;
}) {
  const parsed = accountTransferLifecycleActionSchema.parse(data);
  const revision = await restoreAccountTransfer(
    parsed.id,
    parsed.expectedRevision,
  );
  revalidateAccountTransferPaths();
  return revision;
}

export async function createReimbursementAction(
  data: CreateReimbursementInput,
) {
  const result = await createReimbursementWithResult(
    reimbursementActionSchema.parse(data),
  );
  revalidateAccountTransferPaths();
  return result;
}

export async function createInvoiceAdvancePaymentAction(
  data: CreateInvoiceAdvancePaymentInput,
) {
  const parsed = createInvoiceAdvancePaymentActionSchema.parse(data);

  await createInvoiceAdvancePayment({
    ...parsed,
    paymentMethod: parsed.paymentMethod || "none",
  });

  revalidatePath("/dashboard");
  revalidatePath("/payments");
  revalidatePath("/transactions");
}

export async function createSubscriptionAction(data: CreateSubscriptionInput) {
  const parsed = createSubscriptionActionSchema.parse(data);

  await createSubscription({
    ...parsed,
    category: parsed.category || "none",
    paymentMethod: parsed.paymentMethod || "none",
  });

  revalidatePath("/dashboard");
  revalidatePath("/payments");
  revalidatePath("/transactions");
}

export async function updateSubscriptionAction(data: UpdateSubscriptionInput) {
  const parsed = updateSubscriptionActionSchema.parse(data);

  await updateSubscription({
    ...parsed,
    category: parsed.category || "none",
    paymentMethod: parsed.paymentMethod || "none",
  });

  revalidatePath("/dashboard");
  revalidatePath("/payments");
  revalidatePath("/transactions");
}

export async function pauseSubscriptionAction(subscriptionId: string) {
  const parsedSubscriptionId = uuidSchema.parse(subscriptionId);

  await setSubscriptionPaused(parsedSubscriptionId, true);

  revalidatePath("/dashboard");
  revalidatePath("/payments");
  revalidatePath("/transactions");
}

export async function resumeSubscriptionAction(subscriptionId: string) {
  const parsedSubscriptionId = uuidSchema.parse(subscriptionId);

  await setSubscriptionPaused(parsedSubscriptionId, false);

  revalidatePath("/dashboard");
  revalidatePath("/payments");
  revalidatePath("/transactions");
}

export async function deleteSubscriptionAction(subscriptionId: string) {
  const parsedSubscriptionId = uuidSchema.parse(subscriptionId);

  await deleteSubscription(parsedSubscriptionId);

  revalidatePath("/dashboard");
  revalidatePath("/payments");
  revalidatePath("/transactions");
}

export async function updatePaymentMethodAction(
  data: UpdatePaymentMethodInput,
) {
  const parsed = updatePaymentMethodActionSchema.parse(data);

  await updatePaymentMethod(parsed);

  revalidatePath("/dashboard");
  revalidatePath("/payments");
  revalidatePath("/transactions");
  revalidatePath("/transactions/new");
}

export async function createPaymentMethodAction(
  data: CreatePaymentMethodInput,
) {
  const parsed = createPaymentMethodActionSchema.parse(data);

  await createPaymentMethod(parsed);

  revalidatePath("/dashboard");
  revalidatePath("/payments");
  revalidatePath("/transactions");
  revalidatePath("/transactions/new");
}

export async function deletePaymentMethodAction(paymentMethodId: string) {
  const parsedPaymentMethodId = uuidSchema.parse(paymentMethodId);

  await deletePaymentMethod(parsedPaymentMethodId);

  revalidatePath("/dashboard");
  revalidatePath("/payments");
  revalidatePath("/transactions");
  revalidatePath("/transactions/new");
}

export async function setAccountOpeningBalanceAction(data: {
  amount: number | string;
  effectiveDate: string;
  paymentMethodId: string;
}) {
  const parsed = accountBalanceActionSchema.parse(data);
  await setAccountOpeningBalance(parsed);

  revalidatePath("/dashboard");
  revalidatePath("/payments");
  revalidatePath("/transactions");
}

export async function addAccountBalanceAdjustmentAction(data: {
  amount: number | string;
  effectiveDate: string;
  note?: string;
  paymentMethodId: string;
}) {
  const parsed = accountBalanceAdjustmentActionSchema.parse(data);
  await addAccountBalanceAdjustment(parsed);

  revalidatePath("/dashboard");
  revalidatePath("/payments");
  revalidatePath("/transactions");
}

export async function updateTransactionAction(data: UpdateTransactionInput) {
  const parsed = updateTransactionActionSchema.parse(data);

  await updateTransaction({
    ...parsed,
    category: parsed.category || "none",
    paymentMethod: parsed.paymentMethod || "none",
  });

  revalidatePath("/dashboard");
  revalidatePath("/reports");
  revalidatePath("/transactions");
}

export async function deleteTransactionAction(transactionId: string) {
  const parsedTransactionId = uuidSchema.parse(transactionId);

  await deleteTransaction(parsedTransactionId);

  revalidatePath("/dashboard");
  revalidatePath("/payments");
  revalidatePath("/reports");
  revalidatePath("/transactions");
}

export async function deleteInstallmentsAction(data: DeleteInstallmentsInput) {
  const parsed = deleteInstallmentsActionSchema.parse(data);

  await deleteInstallments(parsed);

  revalidatePath("/dashboard");
  revalidatePath("/payments");
  revalidatePath("/transactions");
}

function revalidateInstallmentLifecycle() {
  revalidatePath("/dashboard");
  revalidatePath("/installments");
  revalidatePath("/payments");
  revalidatePath("/reports");
  revalidatePath("/transactions");
}

export async function previewDeleteInstallmentAction(data: { planId: string }) {
  const { planId } = installmentPlanActionSchema.parse(data);
  return previewDeleteInstallment(planId);
}

export async function deleteInstallmentAction(data: { planId: string }) {
  const { planId } = installmentPlanActionSchema.parse(data);
  await deleteInstallment(planId);
  revalidateInstallmentLifecycle();
}

export async function restoreInstallmentAction(data: { planId: string }) {
  const { planId } = installmentPlanActionSchema.parse(data);
  await restoreInstallment(planId);
  revalidateInstallmentLifecycle();
}

export async function advanceInstallmentsAction(
  data: AdvanceInstallmentsInput,
) {
  const parsed = advanceInstallmentsActionSchema.parse(data);

  await advanceInstallments(parsed);

  revalidatePath("/dashboard");
  revalidatePath("/payments");
  revalidatePath("/transactions");
}

export async function previewInstallmentPrepaymentAction(
  data: AdvanceInstallmentsInput,
) {
  const parsed = advanceInstallmentsActionSchema.parse(data);

  return previewInstallmentPrepayment(parsed);
}

export async function deleteSubscriptionOccurrencesAction(
  data: DeleteSubscriptionOccurrencesInput,
) {
  const parsed = deleteSubscriptionOccurrencesActionSchema.parse(data);

  await deleteSubscriptionOccurrences(parsed);

  revalidatePath("/dashboard");
  revalidatePath("/payments");
  revalidatePath("/transactions");
}
