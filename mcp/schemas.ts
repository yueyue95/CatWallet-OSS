import { z } from "zod";

const month = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must use YYYY-MM format");
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must use YYYY-MM-DD format")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return parsed.toISOString().slice(0, 10) === value;
  }, "date must be a real calendar date");

export const optionalDateSchema = z.object({ date: date.optional() }).strict();

export const optionalMonthSchema = z
  .object({ month: month.optional() })
  .strict();

export const emptyInputSchema = z.object({}).strict();

export const listTransactionsSchema = z
  .object({
    categoryId: z.string().uuid().optional(),
    from: date.optional(),
    limit: z.number().int().min(1).max(100).default(50),
    month: month.optional(),
    paymentAccountId: z.string().uuid().optional(),
    to: date.optional(),
    type: z.enum(["income", "expense", "saving"]).optional(),
    cursor: z
      .string()
      .regex(/^\d+$/, "cursor must be an opaque pagination cursor")
      .default("0"),
  })
  .superRefine((value, context) => {
    if (value.month && (value.from || value.to)) {
      context.addIssue({
        code: "custom",
        message: "Use month or from/to, not both.",
        path: ["month"],
      });
    }
    if (value.from && value.to && value.from > value.to) {
      context.addIssue({
        code: "custom",
        message: "from must not be after to.",
        path: ["from"],
      });
    }
  })
  .strict();

export const listInstallmentsSchema = z
  .object({
    status: z.enum(["active", "completed", "all"]).default("active"),
  })
  .strict();

export const listSinkingFundsSchema = z
  .object({
    active: z.boolean().default(true),
  })
  .strict();

export const listFixedCommitmentsSchema = z
  .object({
    active: z.boolean().default(true),
    month: month.optional(),
  })
  .strict();

export const listGoalsSchema = z
  .object({ active: z.boolean().default(true) })
  .strict();

export const getGoalSchema = z.object({ id: z.string().uuid() }).strict();

export const listCoolingItemsSchema = z
  .object({
    status: z
      .enum(["cooling", "ready", "abandoned", "purchased", "all"])
      .default("all"),
  })
  .strict();

const amount = z.union([
  z.number().finite(),
  z
    .string()
    .regex(/^-?\d+(?:\.\d{1,2})?$/, "amount must use at most two decimals"),
]);

const idempotencyKey = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: "idempotencyKey must not contain control characters",
  });

const paymentAccountType = z.enum([
  "bank",
  "boleto",
  "credit",
  "debit",
  "ewallet",
  "other",
]);

export const createPaymentAccountSchema = z
  .object({
    balanceTrackingEnabled: z.boolean().default(false),
    closingDay: z.number().int().min(1).max(31).nullable().optional(),
    creditLimit: z.number().finite().nonnegative().optional(),
    dueDay: z.number().int().min(1).max(31).nullable().optional(),
    idempotencyKey,
    name: z.string().trim().min(1).max(160),
    type: paymentAccountType,
  })
  .strict();

export const updatePaymentAccountSchema = z
  .object({
    balanceTrackingEnabled: z.boolean().optional(),
    closingDay: z.number().int().min(1).max(31).nullable().optional(),
    creditLimit: z.number().finite().nonnegative().optional(),
    dueDay: z.number().int().min(1).max(31).nullable().optional(),
    id: z.string().uuid(),
    idempotencyKey,
    name: z.string().trim().min(1).max(160),
    type: paymentAccountType,
  })
  .strict();

export const setOpeningBalanceSchema = z
  .object({
    amount,
    effectiveDate: date,
    idempotencyKey,
    paymentAccountId: z.string().uuid(),
  })
  .strict();

export const addBalanceAdjustmentSchema = z
  .object({
    amount,
    effectiveDate: date,
    idempotencyKey,
    note: z.string().trim().max(500).nullable().optional(),
    paymentAccountId: z.string().uuid(),
  })
  .strict();

export const deletePaymentAccountSchema = z
  .object({ id: z.string().uuid(), idempotencyKey })
  .strict();

export const updateTransactionSchema = z
  .object({
    amount: z.number().finite().positive(),
    categoryId: z.string().uuid().nullable(),
    countsTowardFunMoney: z.boolean().default(false),
    date,
    description: z.string().trim().min(1).max(160),
    id: z.string().uuid(),
    idempotencyKey,
    notes: z.string().trim().max(500).nullable().optional(),
    paymentAccountId: z.string().uuid().nullable(),
    type: z.enum(["expense", "income", "saving"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.type !== "expense" && value.countsTowardFunMoney) {
      context.addIssue({
        code: "custom",
        message: "countsTowardFunMoney is only valid for expense transactions",
        path: ["countsTowardFunMoney"],
      });
    }
    if (value.type === "income" && value.categoryId !== null) {
      context.addIssue({
        code: "custom",
        message: "income transactions cannot have a category",
        path: ["categoryId"],
      });
    }
  });

export const transactionLifecycleSchema = z
  .object({ id: z.string().uuid(), idempotencyKey })
  .strict();

export const createCategorySchema = z
  .object({
    group: z.enum(["needs", "wants", "savings"]),
    icon: z.string().trim().min(1).max(16),
    idempotencyKey,
    monthlyLimit: z.number().finite().nonnegative().optional(),
    name: z.string().trim().min(1).max(160),
  })
  .strict();

export const updateCategorySchema = createCategorySchema
  .omit({ idempotencyKey: true })
  .extend({ id: z.string().uuid(), idempotencyKey })
  .strict();

export const archiveCategorySchema = z
  .object({ id: z.string().uuid(), idempotencyKey })
  .strict();

export const deleteCategorySchema = z
  .object({ id: z.string().uuid(), idempotencyKey })
  .strict();

export const fixedCommitmentSchema = z
  .object({
    amount: z.number().finite().positive(),
    cadence: z.enum(["monthly", "yearly", "custom"]),
    categoryId: z.string().uuid().nullable().optional(),
    customIntervalMonths: z
      .number()
      .int()
      .min(1)
      .max(120)
      .nullable()
      .optional(),
    endDate: date.nullable().optional(),
    idempotencyKey,
    includeInSafeToSpend: z.boolean().optional(),
    isEnabled: z.boolean().optional(),
    name: z.string().trim().min(1).max(160),
    paymentAccountId: z.string().uuid().nullable().optional(),
    startDate: date,
  })
  .strict();

export const updateFixedCommitmentSchema = fixedCommitmentSchema
  .extend({ id: z.string().uuid() })
  .strict();

export const recordFixedCommitmentPaymentSchema = z
  .object({
    amount: z.number().finite().positive(),
    commitmentId: z.string().uuid(),
    date,
    description: z.string().trim().min(1).max(160),
    idempotencyKey,
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const goalSchema = z
  .object({
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    currentAmount: z.number().finite().nonnegative().optional(),
    deadline: date,
    icon: z.string().trim().min(1).max(32),
    idempotencyKey,
    name: z.string().trim().min(1).max(160),
    targetAmount: z.number().finite().positive(),
  })
  .strict();

export const updateGoalSchema = goalSchema
  .omit({ currentAmount: true })
  .extend({ id: z.string().uuid() })
  .strict();

export const goalFundsSchema = z
  .object({
    amount: z
      .number()
      .finite()
      .refine((value) => value !== 0),
    entryType: z.enum(["contribution", "withdrawal", "adjustment"]),
    goalId: z.string().uuid(),
    idempotencyKey,
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const deleteGoalSchema = z
  .object({ id: z.string().uuid(), idempotencyKey })
  .strict();

export const sinkingFundSchema = z
  .object({
    currentAmount: z.number().finite().nonnegative().optional(),
    emoji: z.string().trim().min(1).max(16),
    expectedUseDate: date.nullable().optional(),
    idempotencyKey,
    isEnabled: z.boolean().optional(),
    monthlyTarget: z.number().finite().nonnegative(),
    name: z.string().trim().min(1).max(160),
    notes: z.string().trim().max(500).nullable().optional(),
    targetAmount: z.number().finite().positive().nullable().optional(),
  })
  .strict();

export const updateSinkingFundSchema = sinkingFundSchema
  .omit({ currentAmount: true })
  .extend({ id: z.string().uuid() })
  .strict();

export const deleteSinkingFundSchema = z
  .object({ id: z.string().uuid(), idempotencyKey })
  .strict();

export const sinkingFundEntrySchema = z
  .object({
    amount: z
      .number()
      .finite()
      .refine((value) => value !== 0),
    entryType: z.enum(["contribution", "withdrawal", "adjustment"]),
    idempotencyKey,
    note: z.string().trim().max(500).nullable().optional(),
    sinkingFundId: z.string().uuid(),
  })
  .strict();

export const coolingItemSchema = z
  .object({
    amountCents: z.number().int().positive(),
    coolingDays: z.number().int().min(0).max(3650).optional(),
    idempotencyKey,
    name: z.string().trim().min(1).max(160),
    notes: z.string().trim().max(500).nullable().optional(),
    url: z.string().url().max(2048).nullable().optional(),
  })
  .strict();

export const updateCoolingItemSchema = coolingItemSchema
  .extend({ id: z.string().uuid() })
  .strict();

export const deleteCoolingItemSchema = z
  .object({ id: z.string().uuid(), idempotencyKey })
  .strict();

export const coolingStatusSchema = z
  .object({
    id: z.string().uuid(),
    idempotencyKey,
    purchasedTransactionId: z.string().uuid().optional(),
    status: z.enum(["abandoned", "purchased"]),
  })
  .strict();

export const monthlyBudgetSchema = z
  .object({
    idempotencyKey,
    month,
    needsLimit: z.number().finite().nonnegative().optional(),
    savingsLimit: z.number().finite().nonnegative().optional(),
    wantsLimit: z.number().finite().nonnegative().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.needsLimit !== undefined ||
      value.wantsLimit !== undefined ||
      value.savingsLimit !== undefined,
    "At least one budget limit is required",
  );

export const funMoneyBudgetSchema = z
  .object({
    amount: z.number().finite().nonnegative(),
    idempotencyKey,
    month,
  })
  .strict();

export const clearMonthlyBudgetSchema = z
  .object({ idempotencyKey, month })
  .strict();

export const clearFunMoneyBudgetSchema = z
  .object({ idempotencyKey, month })
  .strict();

export const createInstallmentTransportSchema = z
  .object({
    amount: z
      .number()
      .describe(
        "RM amount: at least 0.01, at most two decimal places; total mode must cover every installment.",
      ),
    amountMode: z.enum(["per_installment", "total"]),
    categoryId: z.string().uuid(),
    currentInstallment: z.number().int().min(1),
    date,
    description: z.string().trim().min(1).max(160),
    idempotencyKey,
    notes: z.string().trim().max(500).nullable().optional(),
    paymentAccountId: z.string().uuid(),
    totalInstallments: z.number().int().min(2).max(120),
  })
  .strict();

export const createInstallmentSchema = createInstallmentTransportSchema
  .extend({
    amount: z
      .number()
      .finite()
      .min(0.01, "amount must be at least RM0.01")
      .refine(
        (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7,
        "amount must use at most 2 decimal places",
      ),
  })
  .superRefine((value, context) => {
    if (value.currentInstallment > value.totalInstallments) {
      context.addIssue({
        code: "custom",
        message: "currentInstallment must not exceed totalInstallments",
        path: ["currentInstallment"],
      });
    }
    if (
      value.amountMode === "total" &&
      Math.round(value.amount * 100) < value.totalInstallments
    ) {
      context.addIssue({
        code: "custom",
        message: `amount must be at least RM${(value.totalInstallments / 100).toFixed(2)} for ${value.totalInstallments} installments in total mode`,
        path: ["amount"],
      });
    }
  });

export const updateInstallmentSchema = z
  .object({
    amount: z.number().finite().positive(),
    categoryId: z.string().uuid(),
    date,
    description: z.string().trim().min(1).max(160),
    idempotencyKey,
    installmentId: z.string().uuid(),
    notes: z.string().trim().max(500).nullable().optional(),
    paymentAccountId: z.string().uuid(),
  })
  .strict();

export const installmentPaymentSchema = z
  .object({
    count: z.number().int().min(1).optional(),
    idempotencyKey,
    scope: z.enum(["remaining", "selected_and_remaining"]).optional(),
    targetMonth: month,
    transactionId: z.string().uuid(),
  })
  .strict();

export const completeInstallmentSchema = z
  .object({ idempotencyKey, transactionId: z.string().uuid() })
  .strict();

const importRowSchema = z
  .object({
    amount: z.number().finite().positive(),
    categoryId: z.string().uuid().nullable(),
    date,
    description: z.string().trim().min(1).max(160),
    idempotencyKey: z.string().uuid({ error: "idempotencyKey must be a UUID" }),
    notes: z.string().trim().max(500).nullable().optional(),
    paymentAccountId: z.string().uuid().nullable(),
    type: z.enum(["expense", "income", "saving"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.type === "income" && value.categoryId !== null) {
      context.addIssue({
        code: "custom",
        message: "income transactions cannot have a category",
        path: ["categoryId"],
      });
    }
  });

export const previewTransactionImportSchema = z
  .object({ rows: z.array(importRowSchema).min(1).max(100) })
  .strict();

export const importTransactionsSchema = z
  .object({
    batchIdempotencyKey: idempotencyKey,
    rows: z.array(importRowSchema).min(1).max(100),
  })
  .strict();

export const transactionImportBatchReadSchema = z
  .object({ batchId: z.string().uuid() })
  .strict();

export const transactionImportBatchMutationSchema = z
  .object({ batchId: z.string().uuid(), idempotencyKey })
  .strict();

export type ListTransactionsInput = z.infer<typeof listTransactionsSchema>;
export type OptionalMonthInput = z.infer<typeof optionalMonthSchema>;
