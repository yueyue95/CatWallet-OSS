import {
  McpServer,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import { type McpAuthContextProvider } from "@/mcp/auth/context";
import {
  createTransactionMutation,
  createTransactionSchema,
  type McpMutationDependencies,
} from "@/mcp/mutations";
import {
  addBalanceAdjustmentSchema,
  accountTransferLifecycleSchema,
  archiveCategorySchema,
  coolingItemSchema,
  createCategorySchema,
  createAccountTransferSchema,
  createInstallmentSchema,
  createInstallmentTransportSchema,
  createPaymentAccountSchema,
  createReimbursementSchema,
  deleteCategorySchema,
  deleteCoolingItemSchema,
  deleteGoalSchema,
  deletePaymentAccountSchema,
  deleteInstallmentSchema,
  deleteSinkingFundSchema,
  emptyInputSchema,
  fixedCommitmentSchema,
  getGoalSchema,
  funMoneyBudgetSchema,
  goalFundsSchema,
  goalSchema,
  importTransactionsSchema,
  listCoolingItemsSchema,
  listFixedCommitmentsSchema,
  listGoalsSchema,
  listInstallmentsSchema,
  listSinkingFundsSchema,
  listTransactionsSchema,
  optionalDateSchema,
  optionalMonthSchema,
  coolingStatusSchema,
  completeInstallmentSchema,
  clearFunMoneyBudgetSchema,
  clearMonthlyBudgetSchema,
  installmentPaymentSchema,
  monthlyBudgetSchema,
  previewTransactionImportSchema,
  previewDeleteInstallmentSchema,
  previewAccountTransferSchema,
  transactionImportBatchReadSchema,
  transactionImportBatchMutationSchema,
  recordFixedCommitmentPaymentSchema,
  sinkingFundEntrySchema,
  sinkingFundSchema,
  setOpeningBalanceSchema,
  transactionLifecycleSchema,
  restoreInstallmentSchema,
  updateCategorySchema,
  updateAccountTransferSchema,
  updateCoolingItemSchema,
  updateFixedCommitmentSchema,
  updateGoalSchema,
  updateInstallmentSchema,
  updateSinkingFundSchema,
  updatePaymentAccountSchema,
  updateTransactionSchema,
  type ListTransactionsInput,
} from "@/mcp/schemas";
import {
  addBalanceAdjustmentMutation,
  createAccountTransferMutation,
  archiveCategoryMutation,
  createCategoryMutation,
  createCoolingItemMutation,
  deleteCategoryMutation,
  deleteCoolingItemMutation,
  createFixedCommitmentMutation,
  createGoalMutation,
  createPaymentAccountMutation,
  createReimbursementMutation,
  createSinkingFundMutation,
  deletePaymentAccountMutation,
  deleteAccountTransferMutation,
  deleteInstallmentMutation,
  deleteTransactionMutation,
  deleteGoalMutation,
  deleteSinkingFundMutation,
  disableFixedCommitmentMutation,
  recordFixedCommitmentPaymentMutation,
  recordGoalFundEntryMutation,
  recordSinkingFundEntryMutation,
  restoreTransactionMutation,
  restoreAccountTransferMutation,
  restoreInstallmentMutation,
  setCoolingItemStatusMutation,
  setFunMoneyBudgetMutation,
  setOpeningBalanceMutation,
  setMonthlyBudgetMutation,
  updateCategoryMutation,
  updateAccountTransferMutation,
  updateCoolingItemMutation,
  updateFixedCommitmentMutation,
  updateGoalMutation,
  updateSinkingFundMutation,
  updatePaymentAccountMutation,
  updateTransactionMutation,
  importTransactionsMutation,
  previewTransactionImport,
  getTransactionImportBatch,
  restoreTransactionImport,
  undoTransactionImport,
  clearMonthlyBudgetMutation,
  clearFunMoneyBudgetMutation,
  createInstallmentMutation,
  updateInstallmentMutation,
  recordInstallmentPaymentMutation,
  completeInstallmentMutation,
} from "@/mcp/butler-mutations";
import {
  mcpResponseSchema,
  McpToolError,
  toMcpToolError,
  toolFailure,
  toolSuccess,
} from "@/mcp/response";
import { defaultReadModels, type McpReadModels } from "@/mcp/services";
import { addMonths, monthInTimeZone, resolveMcpTimeZone } from "@/mcp/timezone";
import { getCapabilities } from "@/mcp/capabilities";
import {
  getCoolingReleaseAt,
  getCoolingRemainingMs,
} from "@/lib/finance/cooling-model";
import {
  previewAccountTransfer,
  previewDeleteInstallment,
} from "@/lib/finance/transactions";
import {
  isFixedCommitmentInMonth,
  toMonthlyAmount,
} from "@/lib/finance/safe-to-spend";

export type McpServerOptions = {
  auth: McpAuthContextProvider;
  mutationDependencies?: McpMutationDependencies;
  now?: () => Date;
  oauthScopes?: string[];
  readModels?: McpReadModels;
  timeZone?: string;
};

function oauthSecuritySchemes(scopes: string[]) {
  return [{ scopes, type: "oauth2" }] as const;
}

function parseToolInput<TInput extends z.ZodType>(
  schema: TInput,
  input: unknown,
): z.infer<TInput> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => {
        const field = issue.path.length ? issue.path.join(".") : "input";
        return `${field}: ${issue.message}`;
      })
      .join("; ");
    throw new McpToolError("INVALID_INPUT", `管家请求参数无效：${details}`);
  }
  return parsed.data;
}

function withMonth(options: McpServerOptions, month?: string) {
  return (
    month ??
    monthInTimeZone(
      options.now?.() ?? new Date(),
      options.timeZone ?? resolveMcpTimeZone(),
    )
  );
}

function registerReadOnlyTool<
  TInput extends z.ZodObject<z.ZodRawShape, z.core.$ZodObjectConfig>,
>(
  server: McpServer,
  options: McpServerOptions,
  name: string,
  description: string,
  inputSchema: TInput,
  handler: (
    input: z.infer<TInput>,
    context: Awaited<ReturnType<McpAuthContextProvider["getContext"]>>,
    readModels: McpReadModels,
  ) => Promise<unknown>,
) {
  server.registerTool(
    name,
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      },
      description,
      inputSchema: inputSchema as StandardSchemaWithJSON,
      _meta: {
        securitySchemes: oauthSecuritySchemes(options.oauthScopes ?? []),
      },
      outputSchema: mcpResponseSchema,
    },
    async (input) => {
      try {
        const context = await options.auth.getContext();
        const parsedInput = parseToolInput(inputSchema, input);
        return toolSuccess(
          await handler(
            parsedInput,
            context,
            options.readModels ?? defaultReadModels,
          ),
        );
      } catch (error) {
        const toolError = toMcpToolError(error);
        if (toolError.code === "INTERNAL_ERROR") {
          console.error(`[CatWallet MCP] ${name} failed`);
        }
        return toolFailure(toolError.code, toolError.message);
      }
    },
  );
}

function registerMutationTool<TInput extends z.ZodType>(
  server: McpServer,
  options: McpServerOptions,
  name: string,
  description: string,
  inputSchema: TInput,
  handler: (
    input: z.infer<TInput>,
    context: Awaited<ReturnType<McpAuthContextProvider["getContext"]>>,
  ) => Promise<unknown>,
) {
  server.registerTool(
    name,
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description,
      inputSchema: (name === "create_installment"
        ? createInstallmentTransportSchema
        : inputSchema) as StandardSchemaWithJSON,
      _meta: {
        securitySchemes: oauthSecuritySchemes(options.oauthScopes ?? []),
      },
      outputSchema: mcpResponseSchema,
    },
    async (input) => {
      try {
        const context = await options.auth.getContext();
        const parsedInput = parseToolInput(inputSchema, input);
        return toolSuccess(await handler(parsedInput, context));
      } catch (error) {
        const toolError = toMcpToolError(
          error,
          "CatWallet could not complete this transaction request.",
        );
        if (toolError.code === "INTERNAL_ERROR") {
          console.error(`[CatWallet MCP] ${name} failed`);
        }
        return toolFailure(toolError.code, toolError.message);
      }
    },
  );
}

function transactionView(
  transaction: Awaited<ReturnType<McpReadModels["listTransactions"]>>[number],
) {
  return {
    amount: transaction.amount,
    category: transaction.categoryKey,
    categoryId: transaction.categoryId ?? null,
    countsTowardFunMoney: transaction.countsTowardFunMoney === true,
    date: transaction.date,
    description: transaction.descriptionKey,
    fixedCommitmentId: transaction.fixedCommitmentId ?? null,
    id: transaction.id,
    installment: transaction.installmentGroupId
      ? {
          amount: transaction.installmentAmount ?? null,
          amountMode: transaction.installmentAmountMode ?? null,
          current: transaction.installmentCurrentNumber ?? null,
          groupId: transaction.installmentGroupId,
          number: transaction.installmentNumber ?? null,
          total: transaction.installmentTotal ?? null,
        }
      : null,
    isPlanned: transaction.isPlanned === true,
    notes: transaction.notes ?? null,
    paymentAccount: transaction.paymentMethodKey ?? null,
    paymentAccountId: transaction.paymentMethodId ?? null,
    type: transaction.type,
  };
}

function installmentView(
  item: Awaited<ReturnType<McpReadModels["getInstallments"]>>[number],
) {
  return {
    amountMode: item.amountMode,
    allocations: item.allocations,
    currentInstallment: item.currentInstallment,
    endDate: item.endDate,
    groupId: item.groupId,
    monthlyAmount: item.monthlyAmount,
    name: item.name,
    paidAmount: item.paidAmount,
    paidInstallments: item.paidInstallments,
    remainingAmount: item.remainingAmount,
    remainingInstallments: item.remainingInstallments,
    retired: item.retired,
    retirementStartsMonth: item.retirementStartsMonth,
    totalAmount: item.totalAmount,
    totalInstallments: item.totalInstallments,
  };
}

function resourceLifecycleStatus(item: {
  archivedAt?: string;
  isEnabled: boolean;
}) {
  if (item.archivedAt) return "archived";
  return item.isEnabled ? "active" : "disabled";
}

export function createMcpServer(options: McpServerOptions) {
  const server = new McpServer(
    { name: "catwallet", version: "0.1.1" },
    { capabilities: { tools: {} } },
  );

  registerReadOnlyTool(
    server,
    options,
    "get_capabilities",
    "Return the deployed CatWallet MCP read/write capability matrix and security contract.",
    emptyInputSchema,
    async () => getCapabilities(),
  );

  registerReadOnlyTool(
    server,
    options,
    "get_dashboard_summary",
    "Read the selected month's CatWallet dashboard summary using the existing dashboard and safe-to-spend read models.",
    optionalMonthSchema,
    async ({ month }, context, readModels) => {
      const selectedMonth = withMonth(options, month);
      const [dashboard, funMoney] = await Promise.all([
        readModels.getDashboard(selectedMonth, context),
        readModels.getFunMoney(selectedMonth, context),
      ]);
      return { ...dashboard, funMoney };
    },
  );

  registerReadOnlyTool(
    server,
    options,
    "preview_delete_installment",
    "Preview whether an owned completed installment plan can be safely deleted as one group.",
    previewDeleteInstallmentSchema,
    async ({ planId }, context) => previewDeleteInstallment(planId, context),
  );

  registerReadOnlyTool(
    server,
    options,
    "preview_account_transfer",
    "Preview an owner-scoped same-currency account transfer without writing ledger rows.",
    previewAccountTransferSchema,
    async (input, context) => previewAccountTransfer(input, context),
  );

  registerReadOnlyTool(
    server,
    options,
    "get_safe_to_spend",
    "Read the selected month's existing safe-to-spend result and all of its composing values.",
    optionalMonthSchema,
    async ({ month }, context, readModels) => {
      const selectedMonth = withMonth(options, month);
      const dashboard = await readModels.getSafeToSpend(selectedMonth, context);
      return { month: selectedMonth, ...dashboard.safeToSpend };
    },
  );

  registerReadOnlyTool(
    server,
    options,
    "list_categories",
    "List the authenticated user's transaction categories with stable IDs and readable names so callers never need to guess a UUID.",
    emptyInputSchema,
    async (_input, context, readModels) => {
      const directory = await readModels.getTransactionDirectory(context);
      return { items: directory.categories };
    },
  );

  registerReadOnlyTool(
    server,
    options,
    "list_payment_accounts",
    "List the authenticated user's payment accounts with stable IDs, readable names, account types, cash balances, and credit-card liabilities for safe transaction creation.",
    emptyInputSchema,
    async (_input, context, readModels) => {
      const directory = await readModels.getTransactionDirectory(context);
      return { items: directory.paymentAccounts };
    },
  );

  registerReadOnlyTool(
    server,
    options,
    "get_account_balances",
    "Read the authenticated user's current cash balances or credit-card liabilities, optionally as of a date.",
    optionalDateSchema,
    async ({ date }, context, readModels) => ({
      date: date ?? null,
      items: await readModels.getAccountBalances(date, context),
    }),
  );

  registerReadOnlyTool(
    server,
    options,
    "list_transactions",
    "List the current user's transactions with bounded pagination and optional month/date, type, category, and payment-account filters.",
    listTransactionsSchema,
    async (input: ListTransactionsInput, context, readModels) => {
      const offset = Number(input.cursor);
      const transactions = await readModels.listTransactions(
        {
          categoryId: input.categoryId,
          from: input.from,
          limit: input.limit + 1,
          month: input.month,
          offset,
          paymentMethodId: input.paymentAccountId,
          to: input.to,
          type: input.type,
        },
        context,
      );
      const hasNextPage = transactions.length > input.limit;
      const page = transactions.slice(0, input.limit);
      return {
        items: page.map(transactionView),
        nextCursor: hasNextPage ? String(offset + input.limit) : null,
      };
    },
  );

  registerReadOnlyTool(
    server,
    options,
    "list_installments",
    "List installment plans from the existing CatWallet installment overview, including progress, amount, and retirement allocations.",
    listInstallmentsSchema,
    async ({ status }, context, readModels) => {
      const items = await readModels.getInstallments(context);
      return {
        items: items
          .filter(
            (item) =>
              status === "all" ||
              (status === "completed" ? item.retired : !item.retired),
          )
          .map(installmentView),
        status,
      };
    },
  );

  registerReadOnlyTool(
    server,
    options,
    "get_installment_summary",
    "Read the current installment burden and projects ending in the selected month using the existing installment overview.",
    optionalMonthSchema,
    async ({ month }, context, readModels) => {
      const selectedMonth = withMonth(options, month);
      const nextMonth = addMonths(selectedMonth, 1);
      const items = await readModels.getInstallments(context);
      const active = items.filter((item) => !item.retired);
      const endingThisMonth = active.filter(
        (item) => item.endDate.slice(0, 7) === selectedMonth,
      );
      const endingNextMonth = active.filter(
        (item) => item.endDate.slice(0, 7) === nextMonth,
      );
      return {
        activeMonthlyAmount: Number(
          active
            .reduce((total, item) => total + item.monthlyAmount, 0)
            .toFixed(2),
        ),
        activeRemainingAmount: Number(
          active
            .reduce((total, item) => total + item.remainingAmount, 0)
            .toFixed(2),
        ),
        activeCount: active.length,
        endingNextMonth: endingNextMonth.map(installmentView),
        endingThisMonth: endingThisMonth.map(installmentView),
        month: selectedMonth,
      };
    },
  );

  registerReadOnlyTool(
    server,
    options,
    "list_sinking_funds",
    "List the current user's sinking funds using the existing CatWallet sinking-fund read model.",
    listSinkingFundsSchema,
    async ({ active }, context, readModels) => {
      const items = await readModels.listSinkingFunds(
        context,
        active ? undefined : { includeArchived: true },
      );
      return {
        items: items
          .filter((item) => (item.isEnabled && !item.archivedAt) === active)
          .map((item) => ({
            lifecycleStatus: resourceLifecycleStatus(item),
            currentAmount: item.currentAmount,
            emoji: item.emoji,
            expectedUseDate: item.expectedUseDate,
            id: item.id,
            isEnabled: item.isEnabled,
            monthlyTarget: item.monthlyTarget,
            name: item.name,
            progress:
              item.targetAmount && item.targetAmount > 0
                ? Number(
                    Math.min(
                      (item.currentAmount / item.targetAmount) * 100,
                      100,
                    ).toFixed(2),
                  )
                : null,
            targetAmount: item.targetAmount,
          })),
      };
    },
  );

  registerReadOnlyTool(
    server,
    options,
    "list_fixed_commitments",
    "List the current user's fixed commitments, with month occurrence filtering and explicit safe-to-spend inclusion state.",
    listFixedCommitmentsSchema,
    async ({ active, month }, context, readModels) => {
      const items = await readModels.listFixedCommitments(
        context,
        active ? undefined : { includeArchived: true },
      );
      const activeItems = items.filter(
        (item) => (item.isEnabled && !item.archivedAt) === active,
      );
      const monthItems = month
        ? activeItems.filter((item) => isFixedCommitmentInMonth(item, month))
        : activeItems;
      const monthItemIds = new Set(monthItems.map((item) => item.id));
      return {
        items: (month
          ? activeItems.filter((item) => monthItemIds.has(item.id))
          : activeItems
        ).map((item) => ({
          lifecycleStatus: resourceLifecycleStatus(item),
          amount: item.amount,
          cadence: item.cadence,
          categoryId: item.categoryId,
          categoryName: item.categoryName,
          customIntervalMonths: item.customIntervalMonths,
          endDate: item.endDate,
          id: item.id,
          includeInSafeToSpend: item.includeInSafeToSpend,
          isEnabled: item.isEnabled,
          monthlyAmount: toMonthlyAmount(
            item.amount,
            item.cadence,
            item.customIntervalMonths,
          ),
          name: item.name,
          paymentAccountId: item.paymentMethodId,
          paymentAccountName: item.paymentMethodName,
          startDate: item.startDate,
        })),
        month: month ?? null,
      };
    },
  );

  registerReadOnlyTool(
    server,
    options,
    "list_goals",
    "List the authenticated user's active or archived goals with current amounts.",
    listGoalsSchema,
    async ({ active }, context, readModels) => ({
      items: (
        await readModels.listGoals(
          context,
          active ? undefined : { includeArchived: true },
        )
      )
        .filter((item) => Boolean(item.archivedAt) !== active)
        .map((item) => ({
          ...item,
          lifecycleStatus: item.archivedAt ? "archived" : "active",
        })),
    }),
  );

  registerReadOnlyTool(
    server,
    options,
    "get_goal",
    "Read one owned goal by ID, including its archived state.",
    getGoalSchema,
    async ({ id }, context, readModels) => {
      const item = (
        await readModels.listGoals(context, {
          includeArchived: true,
        })
      ).find((goal) => goal.id === id);
      if (!item)
        throw new McpToolError("NOT_FOUND", "找不到属于当前账号的目标记录。");
      return {
        item: {
          ...item,
          lifecycleStatus: item.archivedAt ? "archived" : "active",
        },
      };
    },
  );

  registerReadOnlyTool(
    server,
    options,
    "get_monthly_report",
    "Read the CatWallet monthly report directly from the Stage 8 getMonthlyReport read model.",
    optionalMonthSchema,
    async ({ month }, context, readModels) =>
      readModels.getMonthlyReport(
        context.userId,
        withMonth(options, month),
        context,
      ),
  );

  registerReadOnlyTool(
    server,
    options,
    "list_cooling_items",
    "List cooling-prison items with dynamic ready status and cooling deadline from the existing cooling model.",
    listCoolingItemsSchema,
    async ({ status }, context, readModels) => {
      const now = new Date();
      const items = await readModels.listCoolingItems(context);
      return {
        items: items
          .filter((item) => status === "all" || item.status === status)
          .map((item) => ({
            addedAt: item.addedAt,
            amount: Number((item.amountCents / 100).toFixed(2)),
            coolingDays: item.coolingDays,
            coolingEndsAt: getCoolingReleaseAt(item).toISOString(),
            id: item.id,
            name: item.name,
            notes: item.notes,
            purchasedTransactionId: item.purchasedTransactionId,
            remainingSeconds: Math.floor(
              getCoolingRemainingMs(item, now) / 1000,
            ),
            status: item.status,
            updatedAt: item.updatedAt,
            url: item.url,
          })),
        status,
      };
    },
  );

  registerMutationTool(
    server,
    options,
    "create_installment",
    "Create an idempotent installment plan using the existing transaction installment service.",
    createInstallmentSchema,
    (input, context) => createInstallmentMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "update_installment",
    "Update one owned scheduled installment occurrence using the existing transaction update service.",
    updateInstallmentSchema,
    (input, context) => updateInstallmentMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "record_installment_payment",
    "Advance an owned installment plan's selected future occurrence using the existing prepayment service.",
    installmentPaymentSchema,
    (input, context) => recordInstallmentPaymentMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "complete_installment",
    "Complete an owned installment plan without deleting its historical transaction rows.",
    completeInstallmentSchema,
    (input, context) => completeInstallmentMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "delete_installment",
    "Soft-delete an eligible completed installment plan and all of its occurrences atomically.",
    deleteInstallmentSchema,
    (input, context) => deleteInstallmentMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "restore_installment",
    "Restore an owned soft-deleted installment plan and all of its occurrences atomically.",
    restoreInstallmentSchema,
    (input, context) => restoreInstallmentMutation(input, context),
  );

  registerMutationTool(
    server,
    options,
    "create_account_transfer",
    "Create one idempotent same-currency transfer with atomic source and destination ledger rows.",
    createAccountTransferSchema,
    (input, context) => createAccountTransferMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "update_account_transfer",
    "Update both sides of an owned transfer atomically with optimistic revision checking.",
    updateAccountTransferSchema,
    (input, context) => updateAccountTransferMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "delete_account_transfer",
    "Soft-delete both sides of an owned transfer atomically.",
    accountTransferLifecycleSchema,
    (input, context) => deleteAccountTransferMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "restore_account_transfer",
    "Restore both sides of an owned transfer atomically.",
    accountTransferLifecycleSchema,
    (input, context) => restoreAccountTransferMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "create_reimbursement",
    "Record an idempotent contra-expense receipt linked to an owned original expense.",
    createReimbursementSchema,
    (input, context) => createReimbursementMutation(input, context),
  );

  registerMutationTool(
    server,
    options,
    "create_transaction",
    "Create one CatWallet transaction for the authenticated user. The request is idempotent per user and idempotencyKey.",
    createTransactionSchema,
    (input, context) =>
      createTransactionMutation(input, context, options.mutationDependencies),
  );

  registerMutationTool(
    server,
    options,
    "create_payment_account",
    "Create a payment account for the authenticated user with an idempotent request.",
    createPaymentAccountSchema,
    (input, context) => createPaymentAccountMutation(input, context),
  );

  registerMutationTool(
    server,
    options,
    "update_payment_account",
    "Update an owned payment account's name, type, dates, limits, or balance tracking state.",
    updatePaymentAccountSchema,
    (input, context) => updatePaymentAccountMutation(input, context),
  );

  registerMutationTool(
    server,
    options,
    "set_opening_balance",
    "Set an owned payment account's immutable opening balance once; corrections use adjustments.",
    setOpeningBalanceSchema,
    (input, context) => setOpeningBalanceMutation(input, context),
  );

  registerMutationTool(
    server,
    options,
    "add_balance_adjustment",
    "Add an owner-scoped balance adjustment to a payment account.",
    addBalanceAdjustmentSchema,
    (input, context) => addBalanceAdjustmentMutation(input, context),
  );

  registerMutationTool(
    server,
    options,
    "delete_payment_account",
    "Safely delete an owned empty payment account; active references are rejected by the existing atomic cleanup RPC.",
    deletePaymentAccountSchema,
    (input, context) => deletePaymentAccountMutation(input, context),
  );

  registerMutationTool(
    server,
    options,
    "update_transaction",
    "Update an owned transaction while preserving existing category, account, date, and money validation.",
    updateTransactionSchema,
    (input, context) => updateTransactionMutation(input, context),
  );

  registerMutationTool(
    server,
    options,
    "delete_transaction",
    "Soft-delete an owned transaction so it can be restored without losing history.",
    transactionLifecycleSchema,
    (input, context) => deleteTransactionMutation(input, context),
  );

  registerMutationTool(
    server,
    options,
    "restore_transaction",
    "Restore an owned soft-deleted transaction.",
    transactionLifecycleSchema,
    (input, context) => restoreTransactionMutation(input, context),
  );

  registerMutationTool(
    server,
    options,
    "create_category",
    "Create a custom transaction category owned by the authenticated user.",
    createCategorySchema,
    (input, context) => createCategoryMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "update_category",
    "Update an owned transaction category without changing historical transaction ownership.",
    updateCategorySchema,
    (input, context) => updateCategoryMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "archive_category",
    "Archive an owned category; historical transactions keep their category reference.",
    archiveCategorySchema,
    (input, context) => archiveCategoryMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "delete_category",
    "Hard-delete an owned category only when it has no historical references; archive categories with history.",
    deleteCategorySchema,
    (input, context) => deleteCategoryMutation(input, context),
  );

  registerMutationTool(
    server,
    options,
    "create_fixed_commitment",
    "Create an owned recurring fixed commitment with explicit recurrence and safe-to-spend settings.",
    fixedCommitmentSchema,
    (input, context) => createFixedCommitmentMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "update_fixed_commitment",
    "Update an owned fixed commitment.",
    updateFixedCommitmentSchema,
    (input, context) => updateFixedCommitmentMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "disable_fixed_commitment",
    "Disable an owned fixed commitment without deleting its history.",
    transactionLifecycleSchema,
    (input, context) => disableFixedCommitmentMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "record_fixed_commitment_payment",
    "Create one idempotent real expense linked to an owned fixed commitment.",
    recordFixedCommitmentPaymentSchema,
    (input, context) => recordFixedCommitmentPaymentMutation(input, context),
  );

  registerMutationTool(
    server,
    options,
    "create_goal",
    "Create an owned savings goal.",
    goalSchema,
    (input, context) => createGoalMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "update_goal",
    "Update an owned savings goal.",
    updateGoalSchema,
    (input, context) => updateGoalMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "record_goal_fund_entry",
    "Record an idempotent contribution to an owned goal using the existing goal-funds business rule.",
    goalFundsSchema,
    (input, context) => recordGoalFundEntryMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "delete_goal",
    "Archive an owned savings goal.",
    deleteGoalSchema,
    (input, context) => deleteGoalMutation(input, context),
  );

  registerMutationTool(
    server,
    options,
    "create_sinking_fund",
    "Create an owned sinking fund.",
    sinkingFundSchema,
    (input, context) => createSinkingFundMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "update_sinking_fund",
    "Update an owned sinking fund's display and target configuration.",
    updateSinkingFundSchema,
    (input, context) => updateSinkingFundMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "archive_sinking_fund",
    "Archive an owned sinking fund without deleting its movement history.",
    deleteSinkingFundSchema,
    (input, context) => deleteSinkingFundMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "record_sinking_fund_entry",
    "Record an idempotent contribution, withdrawal, or adjustment to an owned sinking fund.",
    sinkingFundEntrySchema,
    (input, context) => recordSinkingFundEntryMutation(input, context),
  );

  registerMutationTool(
    server,
    options,
    "create_cooling_item",
    "Create an owned cooling-prison item without changing safe-to-spend.",
    coolingItemSchema,
    (input, context) => createCoolingItemMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "update_cooling_item",
    "Update an owned cooling item before it has a purchase or abandonment action.",
    updateCoolingItemSchema,
    (input, context) => updateCoolingItemMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "delete_cooling_item",
    "Delete an owned cooling item only before it has a purchase or abandonment action.",
    deleteCoolingItemSchema,
    (input, context) => deleteCoolingItemMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "set_cooling_item_status",
    "Abandon or link-purchase an owned cooling item; purchasing requires an existing transaction.",
    coolingStatusSchema,
    (input, context) => setCoolingItemStatusMutation(input, context),
  );

  registerMutationTool(
    server,
    options,
    "set_monthly_budget",
    "Set budget limits for one selected month only.",
    monthlyBudgetSchema,
    (input, context) => setMonthlyBudgetMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "clear_monthly_budget",
    "Clear the selected month's manual budget limits without changing transactions.",
    clearMonthlyBudgetSchema,
    (input, context) => clearMonthlyBudgetMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "clear_fun_money_budget",
    "Clear the selected month's fun-money limit without changing transactions.",
    clearFunMoneyBudgetSchema,
    (input, context) => clearFunMoneyBudgetMutation(input, context),
  );
  registerMutationTool(
    server,
    options,
    "set_fun_money_budget",
    "Set the selected month's fun-money amount without creating a transaction.",
    funMoneyBudgetSchema,
    (input, context) => setFunMoneyBudgetMutation(input, context),
  );

  registerReadOnlyTool(
    server,
    options,
    "preview_transaction_import",
    "Preview a bounded transaction import with create, skip-duplicate, and reject details without writing data.",
    previewTransactionImportSchema,
    (input, context) => previewTransactionImport(input, context),
  );
  registerMutationTool(
    server,
    options,
    "import_transactions",
    "Atomically import a bounded, prevalidated transaction batch with per-row idempotency.",
    importTransactionsSchema,
    (input, context) => importTransactionsMutation(input, context),
  );
  registerReadOnlyTool(
    server,
    options,
    "get_transaction_import_batch",
    "Read the authenticated user's persisted transaction import impact and current undo state.",
    transactionImportBatchReadSchema,
    (input, context) => getTransactionImportBatch(input, context),
  );
  registerMutationTool(
    server,
    options,
    "undo_transaction_import",
    "Undo all active transactions belonging to one owned import batch without deleting its audit trail.",
    transactionImportBatchMutationSchema,
    (input, context) => undoTransactionImport(input, context),
  );
  registerMutationTool(
    server,
    options,
    "restore_transaction_import",
    "Restore the soft-deleted transactions belonging to one owned import batch.",
    transactionImportBatchMutationSchema,
    (input, context) => restoreTransactionImport(input, context),
  );

  return server;
}

export function createReadOnlyMcpServer(options: McpServerOptions) {
  return createMcpServer(options);
}
