import {
  addAccountBalanceAdjustment,
  listAccountBalances,
  setAccountOpeningBalance,
} from "@/lib/finance/account-balances";
import {
  archiveGoal,
  createCategory,
  createGoal,
  createPaymentMethod,
  archiveCategory,
  deleteCategory,
  deletePaymentMethod,
  deleteTransaction,
  restoreTransaction,
  updateCategory,
  updateGoal,
  updatePaymentMethod,
  updateTransaction,
  createTransactionsBatchWithResult,
  createTransactionWithResult,
  advanceInstallments,
  completeInstallment,
  listTransactions,
  type AuthenticatedUserContext,
} from "@/lib/finance/transactions";
import { getTransactionById } from "@/lib/finance/transactions";
import {
  createFixedCommitment,
  createSinkingFund,
  deleteFixedCommitment,
  deleteSinkingFund,
  recordFixedCommitmentPayment,
  updateFixedCommitment,
  updateSinkingFund,
  setFunMoneyBudget,
  recordGoalFundEntry,
  recordSinkingFundEntry,
  type FixedCommitmentInput,
  type SinkingFundInput,
} from "@/lib/finance/catwallet";
import type { InstallmentAmountMode } from "@/lib/data";
import {
  buildTransactionImportPreview,
  type TransactionImportRow,
} from "@/lib/finance/transaction-import";
import {
  createCoolingItem,
  deleteCoolingItem,
  markCoolingItemPurchased,
  updateCoolingItem,
} from "@/lib/finance/cooling";
import { McpToolError } from "@/mcp/response";
import {
  claimMcpIdempotency,
  completeMcpIdempotency,
  deriveMcpEntityId,
  failMcpIdempotency,
  recordMcpMutationAudit,
  requestFingerprint,
} from "@/mcp/idempotency";

const invalidMutationFieldMessages = [
  [/amount/i, "amount: 金额必须大于 RM0.00，且最多使用两位小数。"],
  [/date/i, "date: 日期格式无效。请使用 YYYY-MM-DD。"],
  [/category/i, "categoryId: 分类无效，请选择当前账号可用的分类。"],
  [/payment/i, "paymentAccountId: 支付账户无效，请选择当前账号可用的账户。"],
  [
    /installment|period|count/i,
    "currentInstallment/totalInstallments: 分期期数无效。请确认期数范围与当前期数。",
  ],
  [/type/i, "type: 交易类型无效。"],
] as const;

function isInvalidMutationInput(message: string) {
  return /required|must|too long|invalid|amount|date|type|category|payment/i.test(
    message,
  );
}

function mapInvalidMutationInput(message: string) {
  if (!isInvalidMutationInput(message)) return null;
  const fieldMessage = invalidMutationFieldMessages.find(([pattern]) =>
    pattern.test(message),
  )?.[1];
  return new McpToolError(
    "INVALID_INPUT",
    fieldMessage ?? "请求中的财务字段无效。",
  );
}

function mapMutationError(error: unknown): McpToolError {
  if (error instanceof McpToolError) return error;
  const message = error instanceof Error ? error.message : "";
  if (/not found|does not belong|not owned/i.test(message)) {
    return new McpToolError("NOT_FOUND", "找不到属于当前账号的目标记录。");
  }
  if (
    /already|cannot|history|reference|active|different|exists|archive|insufficient.*balance/i.test(
      message,
    )
  ) {
    return new McpToolError("CONFLICT", "当前操作与记录状态或既有引用冲突。");
  }
  const inputError = mapInvalidMutationInput(message);
  if (inputError) return inputError;
  return new McpToolError("INTERNAL_ERROR", "CatWallet 无法完成这项管家操作。");
}

function withoutIdempotencyKey<T extends { idempotencyKey: string }>(
  input: T,
): Omit<T, "idempotencyKey"> {
  const copy = { ...input } as Omit<T, "idempotencyKey"> & {
    idempotencyKey?: string;
  };
  delete copy.idempotencyKey;
  return copy as Omit<T, "idempotencyKey">;
}

async function runIdempotent<T>(
  context: AuthenticatedUserContext,
  input: {
    action:
      | "create"
      | "update"
      | "delete"
      | "restore"
      | "set"
      | "adjust"
      | "record"
      | "import";
    idempotencyKey: string;
    payload: unknown;
    toolName: string;
  },
  operation: (
    entityId: string,
  ) => Promise<{ entityId?: string | null; result: T }>,
) {
  const fingerprint = requestFingerprint(input.payload);
  const checked = await claimMcpIdempotency(context, {
    idempotencyKey: input.idempotencyKey,
    payloadHash: fingerprint,
    toolName: input.toolName,
  });
  if (checked.replayed) {
    if (!checked.entityId) {
      throw new McpToolError(
        "INTERNAL_ERROR",
        "CatWallet idempotency result is missing its entity reference.",
      );
    }
    try {
      await recordMcpMutationAudit(context, {
        action: input.action,
        entityId: checked.entityId,
        idempotencyKey: input.idempotencyKey,
        idempotencyKeyHash: checked.idempotencyKeyHash,
        requestFingerprint: fingerprint,
        success: true,
        toolName: input.toolName,
      });
    } catch {
      // A replay remains safe if the append-only audit write is unavailable.
    }
    return {
      idempotencyResult: "replayed" as const,
      entityId: checked.entityId,
      result: { id: checked.entityId } as T,
    };
  }

  const entityId = deriveMcpEntityId(
    context.userId,
    input.toolName,
    input.idempotencyKey,
  );
  let completed: { entityId?: string | null; result: T };
  try {
    completed = await operation(entityId);
  } catch (error) {
    const mapped = mapMutationError(error);
    try {
      await failMcpIdempotency(context, {
        idempotencyKeyHash: checked.idempotencyKeyHash,
        toolName: input.toolName,
      });
    } catch {
      // Keep the original business error; idempotency failure must not expose details.
    }
    try {
      await recordMcpMutationAudit(context, {
        action: input.action,
        entityId,
        errorCode: mapped.code,
        idempotencyKey: input.idempotencyKey,
        idempotencyKeyHash: checked.idempotencyKeyHash,
        requestFingerprint: fingerprint,
        success: false,
        toolName: input.toolName,
      });
    } catch {
      // Keep the original business error; audit failure must not expose details.
    }
    throw mapped;
  }

  const completedEntityId = completed.entityId ?? entityId;
  try {
    await completeMcpIdempotency(context, {
      entityId: completedEntityId,
      idempotencyKeyHash: checked.idempotencyKeyHash,
      toolName: input.toolName,
    });
  } catch (error) {
    try {
      await recordMcpMutationAudit(context, {
        action: input.action,
        entityId: completedEntityId,
        errorCode: null,
        idempotencyKey: input.idempotencyKey,
        idempotencyKeyHash: checked.idempotencyKeyHash,
        requestFingerprint: fingerprint,
        success: true,
        toolName: input.toolName,
      });
    } catch {
      // Keep the idempotency storage error; audit failure must not expose details.
    }
    throw error;
  }

  try {
    await recordMcpMutationAudit(context, {
      action: input.action,
      entityId: completedEntityId,
      idempotencyKey: input.idempotencyKey,
      idempotencyKeyHash: checked.idempotencyKeyHash,
      requestFingerprint: fingerprint,
      success: true,
      toolName: input.toolName,
    });
  } catch {
    // Keep the successful mutation result; audit failure must not expose details.
  }
  return {
    entityId: completedEntityId,
    idempotencyResult: "created" as const,
    result: completed.result,
  };
}

export async function createPaymentAccountMutation(
  input: {
    balanceTrackingEnabled: boolean;
    closingDay?: number | null;
    creditLimit?: number;
    dueDay?: number | null;
    idempotencyKey: string;
    name: string;
    type: "bank" | "boleto" | "credit" | "debit" | "ewallet" | "other";
  },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "create",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "create_payment_account",
    },
    async (entityId) => {
      await createPaymentMethod({ ...input, id: entityId }, context);
      return { entityId, result: { id: entityId } };
    },
  );
}

export async function updatePaymentAccountMutation(
  input: {
    balanceTrackingEnabled?: boolean;
    closingDay?: number | null;
    creditLimit?: number;
    dueDay?: number | null;
    id: string;
    idempotencyKey: string;
    name: string;
    type: "bank" | "boleto" | "credit" | "debit" | "ewallet" | "other";
  },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "update",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "update_payment_account",
    },
    async () => {
      await updatePaymentMethod(input, context);
      return { entityId: input.id, result: { id: input.id } };
    },
  );
}

export async function setOpeningBalanceMutation(
  input: {
    amount: number | string;
    effectiveDate: string;
    idempotencyKey: string;
    paymentAccountId: string;
  },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "set",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "set_opening_balance",
    },
    async () => {
      await setAccountOpeningBalance({
        amount: input.amount,
        effectiveDate: input.effectiveDate,
        paymentMethodId: input.paymentAccountId,
        userContext: context,
      });
      const account = (await listAccountBalances(context)).find(
        (item) => item.id === input.paymentAccountId,
      );
      if (!account) throw new Error("Payment account not found.");
      return { entityId: account.id, result: account };
    },
  );
}

export async function addBalanceAdjustmentMutation(
  input: {
    amount: number | string;
    effectiveDate: string;
    idempotencyKey: string;
    note?: string | null;
    paymentAccountId: string;
  },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "adjust",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "add_balance_adjustment",
    },
    async () => {
      await addAccountBalanceAdjustment({
        amount: input.amount,
        effectiveDate: input.effectiveDate,
        note: input.note,
        paymentMethodId: input.paymentAccountId,
        userContext: context,
      });
      const account = (await listAccountBalances(context)).find(
        (item) => item.id === input.paymentAccountId,
      );
      if (!account) throw new Error("Payment account not found.");
      return { entityId: account.id, result: account };
    },
  );
}

export async function deletePaymentAccountMutation(
  input: { id: string; idempotencyKey: string },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "delete",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "delete_payment_account",
    },
    async () => {
      await deletePaymentMethod(input.id, context);
      return { entityId: input.id, result: { id: input.id, deleted: true } };
    },
  );
}

export async function updateTransactionMutation(
  input: {
    amount: number;
    categoryId: string | null;
    countsTowardFunMoney: boolean;
    date: string;
    description: string;
    id: string;
    idempotencyKey: string;
    notes?: string | null;
    paymentAccountId: string | null;
    type: "expense" | "income" | "saving";
  },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "update",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "update_transaction",
    },
    async () => {
      await updateTransaction(
        {
          amount: input.amount,
          category: input.categoryId ?? "none",
          countsTowardFunMoney: input.countsTowardFunMoney,
          date: input.date,
          description: input.description,
          id: input.id,
          notes: input.notes ?? undefined,
          paymentMethod: input.paymentAccountId ?? "none",
          type: input.type,
        },
        context,
      );
      return {
        entityId: input.id,
        result: await getTransactionById(input.id, context),
      };
    },
  );
}

export async function deleteTransactionMutation(
  input: { id: string; idempotencyKey: string },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "delete",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "delete_transaction",
    },
    async () => {
      await deleteTransaction(input.id, context);
      return { entityId: input.id, result: { id: input.id, deleted: true } };
    },
  );
}

export async function restoreTransactionMutation(
  input: { id: string; idempotencyKey: string },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "restore",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "restore_transaction",
    },
    async () => {
      await restoreTransaction(input.id, context);
      return {
        entityId: input.id,
        result: await getTransactionById(input.id, context),
      };
    },
  );
}

export async function createInstallmentMutation(
  input: {
    amount: number;
    amountMode: InstallmentAmountMode;
    categoryId: string;
    currentInstallment: number;
    date: string;
    description: string;
    idempotencyKey: string;
    notes?: string | null;
    paymentAccountId: string;
    totalInstallments: number;
  },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "create",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "create_installment",
    },
    async () => {
      const transactionId = deriveMcpEntityId(
        context.userId,
        "create_installment",
        input.idempotencyKey,
      );
      const created = await createTransactionWithResult(
        {
          amount: input.amount,
          category: input.categoryId,
          date: input.date,
          description: input.description,
          idempotencyKey: transactionId,
          installmentAmountMode: input.amountMode,
          installmentCount: input.totalInstallments,
          currentInstallment: input.currentInstallment,
          notes: input.notes ?? undefined,
          paymentMethod: input.paymentAccountId,
          type: "expense",
        },
        context,
      );
      const transaction = await getTransactionById(
        created.transactionId,
        context,
      );
      return {
        entityId: created.transactionId,
        result: {
          idempotencyResult: created.replayed ? "replayed" : "created",
          installmentGroupId: transaction.installmentGroupId,
          transactionId: created.transactionId,
        },
      };
    },
  );
}

export async function updateInstallmentMutation(
  input: {
    amount: number;
    categoryId: string;
    date: string;
    description: string;
    idempotencyKey: string;
    installmentId: string;
    notes?: string | null;
    paymentAccountId: string;
  },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "update",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "update_installment",
    },
    async () => {
      const existing = await getTransactionById(input.installmentId, context);
      if (!existing.installmentGroupId) {
        throw new Error("Transaction is not an installment.");
      }
      await updateTransaction(
        {
          amount: input.amount,
          category: input.categoryId,
          countsTowardFunMoney: false,
          date: input.date,
          description: input.description,
          id: input.installmentId,
          notes: input.notes ?? undefined,
          paymentMethod: input.paymentAccountId,
          type: "expense",
        },
        context,
      );
      return {
        entityId: input.installmentId,
        result: { id: input.installmentId, updated: true },
      };
    },
  );
}

export async function recordInstallmentPaymentMutation(
  input: {
    count?: number;
    idempotencyKey: string;
    scope?: "remaining" | "selected_and_remaining";
    targetMonth: string;
    transactionId: string;
  },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "record",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "record_installment_payment",
    },
    async () => {
      await advanceInstallments(
        {
          count: input.count ?? 1,
          scope: input.scope,
          targetMonth: input.targetMonth,
          transactionId: input.transactionId,
        },
        context,
      );
      return {
        entityId: input.transactionId,
        result: { advanced: true, transactionId: input.transactionId },
      };
    },
  );
}

export async function completeInstallmentMutation(
  input: { idempotencyKey: string; transactionId: string },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "set",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "complete_installment",
    },
    async () => {
      await completeInstallment(input.transactionId, context);
      return {
        entityId: input.transactionId,
        result: { completed: true, transactionId: input.transactionId },
      };
    },
  );
}

export async function createCategoryMutation(
  input: {
    group: "needs" | "wants" | "savings";
    icon: string;
    idempotencyKey: string;
    monthlyLimit?: number;
    name: string;
  },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "create",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "create_category",
    },
    async (entityId) => {
      await createCategory({ ...input, id: entityId }, context);
      return { entityId, result: { id: entityId } };
    },
  );
}

export async function updateCategoryMutation(
  input: {
    group: "needs" | "wants" | "savings";
    icon: string;
    id: string;
    idempotencyKey: string;
    monthlyLimit?: number;
    name: string;
  },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "update",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "update_category",
    },
    async () => {
      await updateCategory(input, context);
      return { entityId: input.id, result: { id: input.id } };
    },
  );
}

export async function archiveCategoryMutation(
  input: { id: string; idempotencyKey: string },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "delete",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "archive_category",
    },
    async () => {
      await archiveCategory(input.id, context);
      return { entityId: input.id, result: { id: input.id, archived: true } };
    },
  );
}

export async function deleteCategoryMutation(
  input: { id: string; idempotencyKey: string },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "delete",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "delete_category",
    },
    async () => {
      await deleteCategory(input.id, context);
      return { entityId: input.id, result: { deleted: true, id: input.id } };
    },
  );
}

type FixedCommitmentMutationInput = Omit<
  FixedCommitmentInput,
  "paymentMethodId"
> & { paymentAccountId?: string | null };

export async function createFixedCommitmentMutation(
  input: FixedCommitmentMutationInput & { idempotencyKey: string },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "create",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "create_fixed_commitment",
    },
    async (entityId) => {
      const { paymentAccountId, ...commitment } = withoutIdempotencyKey(input);
      const result = await createFixedCommitment(
        {
          ...commitment,
          id: entityId,
          paymentMethodId: paymentAccountId ?? null,
        },
        context,
      );
      return { entityId, result };
    },
  );
}

export async function updateFixedCommitmentMutation(
  input: FixedCommitmentMutationInput & { id: string; idempotencyKey: string },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "update",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "update_fixed_commitment",
    },
    async () => {
      const { paymentAccountId, ...commitment } = withoutIdempotencyKey(input);
      const result = await updateFixedCommitment(
        { ...commitment, paymentMethodId: paymentAccountId ?? null },
        context,
      );
      return { entityId: input.id, result };
    },
  );
}

export async function disableFixedCommitmentMutation(
  input: { id: string; idempotencyKey: string },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "delete",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "disable_fixed_commitment",
    },
    async () => {
      await deleteFixedCommitment(input.id, context);
      return { entityId: input.id, result: { id: input.id, disabled: true } };
    },
  );
}

export async function recordFixedCommitmentPaymentMutation(
  input: {
    amount: number;
    commitmentId: string;
    date: string;
    description: string;
    idempotencyKey: string;
    notes?: string | null;
  },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "record",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "record_fixed_commitment_payment",
    },
    async (entityId) => {
      const payment = withoutIdempotencyKey(input);
      await recordFixedCommitmentPayment({ ...payment, id: entityId }, context);
      return { entityId, result: { transactionId: entityId } };
    },
  );
}

export async function createGoalMutation(
  input: {
    color: string;
    currentAmount?: number;
    deadline: string;
    icon: string;
    idempotencyKey: string;
    name: string;
    targetAmount: number;
  },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "create",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "create_goal",
    },
    async (entityId) => {
      const goal = withoutIdempotencyKey(input);
      if ((goal.currentAmount ?? 0) !== 0) {
        throw new McpToolError(
          "INVALID_INPUT",
          "目标创建后请使用 record_goal_fund_entry 记录存入金额。",
        );
      }
      await createGoal({ ...goal, id: entityId }, context);
      return { entityId, result: { id: entityId } };
    },
  );
}

export async function updateGoalMutation(
  input: {
    color: string;
    currentAmount?: number;
    deadline: string;
    icon: string;
    id: string;
    idempotencyKey: string;
    name: string;
    targetAmount: number;
  },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "update",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "update_goal",
    },
    async () => {
      const goal = withoutIdempotencyKey(input);
      await updateGoal(goal, context);
      return { entityId: input.id, result: { id: input.id } };
    },
  );
}

export async function recordGoalFundEntryMutation(
  input: {
    amount: number;
    entryType: "contribution" | "withdrawal" | "adjustment";
    goalId: string;
    idempotencyKey: string;
    note?: string | null;
  },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "record",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "record_goal_fund_entry",
    },
    async () => {
      const currentAmount = await recordGoalFundEntry({ ...input }, context);
      return {
        entityId: input.goalId,
        result: { currentAmount, goalId: input.goalId },
      };
    },
  );
}

export async function deleteGoalMutation(
  input: { id: string; idempotencyKey: string },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "delete",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "delete_goal",
    },
    async () => {
      await archiveGoal(input.id, context);
      return { entityId: input.id, result: { archived: true, id: input.id } };
    },
  );
}

export async function createSinkingFundMutation(
  input: SinkingFundInput & { idempotencyKey: string },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "create",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "create_sinking_fund",
    },
    async (entityId) => {
      const fund = withoutIdempotencyKey(input);
      if ((fund.currentAmount ?? 0) !== 0) {
        throw new McpToolError(
          "INVALID_INPUT",
          "储蓄罐创建后请使用 record_sinking_fund_entry 记录存入金额。",
        );
      }
      const result = await createSinkingFund(
        { ...fund, id: entityId },
        context,
      );
      return { entityId, result };
    },
  );
}

export async function updateSinkingFundMutation(
  input: SinkingFundInput & { id: string; idempotencyKey: string },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "update",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "update_sinking_fund",
    },
    async () => {
      const fund = withoutIdempotencyKey(input);
      const result = await updateSinkingFund(fund, context);
      return { entityId: input.id, result };
    },
  );
}

export async function deleteSinkingFundMutation(
  input: { id: string; idempotencyKey: string },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "delete",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "archive_sinking_fund",
    },
    async () => {
      await deleteSinkingFund(input.id, context);
      return { entityId: input.id, result: { archived: true, id: input.id } };
    },
  );
}

export async function recordSinkingFundEntryMutation(
  input: {
    amount: number;
    entryType: "contribution" | "withdrawal" | "adjustment";
    idempotencyKey: string;
    note?: string | null;
    sinkingFundId: string;
  },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "record",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "record_sinking_fund_entry",
    },
    async () => {
      const currentAmount = await recordSinkingFundEntry(input, context);
      return {
        entityId: input.sinkingFundId,
        result: { currentAmount, sinkingFundId: input.sinkingFundId },
      };
    },
  );
}

export async function createCoolingItemMutation(
  input: {
    amountCents: number;
    coolingDays?: number;
    idempotencyKey: string;
    name: string;
    notes?: string | null;
    url?: string | null;
  },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "create",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "create_cooling_item",
    },
    async (entityId) => {
      const item = withoutIdempotencyKey(input);
      const result = await createCoolingItem(
        { ...item, id: entityId },
        context,
      );
      return { entityId, result };
    },
  );
}

export async function updateCoolingItemMutation(
  input: {
    amountCents: number;
    coolingDays?: number;
    id: string;
    idempotencyKey: string;
    name: string;
    notes?: string | null;
    url?: string | null;
  },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "update",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "update_cooling_item",
    },
    async () => {
      const { id, ...item } = withoutIdempotencyKey(input);
      const result = await updateCoolingItem(id, item, context);
      return { entityId: id, result };
    },
  );
}

export async function deleteCoolingItemMutation(
  input: { id: string; idempotencyKey: string },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "delete",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "delete_cooling_item",
    },
    async () => {
      await deleteCoolingItem(input.id, context);
      return { entityId: input.id, result: { deleted: true, id: input.id } };
    },
  );
}

export async function setCoolingItemStatusMutation(
  input: {
    id: string;
    idempotencyKey: string;
    purchasedTransactionId?: string;
    status: "abandoned" | "purchased";
  },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "set",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "set_cooling_item_status",
    },
    async () => {
      if (input.status === "purchased") {
        if (!input.purchasedTransactionId)
          throw new Error("Purchased transaction is required.");
        await markCoolingItemPurchased(
          input.id,
          input.purchasedTransactionId,
          context,
        );
      } else {
        const { data, error } = await context.supabase
          .from("cooling_items")
          .update({ status: "abandoned" })
          .eq("id", input.id)
          .eq("user_id", context.userId)
          .in("status", ["cooling", "ready"])
          .select("id")
          .maybeSingle();
        if (error)
          throw new Error(`Unable to abandon cooling item: ${error.message}`);
        if (!data) throw new Error("Cooling item is no longer available.");
      }
      return {
        entityId: input.id,
        result: { id: input.id, status: input.status },
      };
    },
  );
}

export async function setMonthlyBudgetMutation(
  input: {
    idempotencyKey: string;
    month: string;
    needsLimit?: number;
    savingsLimit?: number;
    wantsLimit?: number;
  },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "set",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "set_monthly_budget",
    },
    async (entityId) => {
      const { month, ...limits } = withoutIdempotencyKey(input);
      const { data: existing, error: loadError } = await context.supabase
        .from("monthly_budgets")
        .select("needs_limit, savings_limit, wants_limit")
        .eq("user_id", context.userId)
        .eq("month", `${month}-01`)
        .maybeSingle();
      if (loadError) {
        throw new Error(`Unable to load monthly budget: ${loadError.message}`);
      }
      const { error } = await context.supabase.from("monthly_budgets").upsert(
        {
          month: `${month}-01`,
          user_id: context.userId,
          needs_limit: limits.needsLimit ?? existing?.needs_limit ?? null,
          savings_limit: limits.savingsLimit ?? existing?.savings_limit ?? null,
          wants_limit: limits.wantsLimit ?? existing?.wants_limit ?? null,
        },
        { onConflict: "user_id,month" },
      );
      if (error)
        throw new Error(`Unable to save monthly budget: ${error.message}`);
      return {
        entityId,
        result: { month, ...limits },
      };
    },
  );
}

export async function setFunMoneyBudgetMutation(
  input: { amount: number; idempotencyKey: string; month: string },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "set",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "set_fun_money_budget",
    },
    async (entityId) => {
      await setFunMoneyBudget(
        { amount: input.amount, month: input.month },
        context,
      );
      return {
        entityId,
        result: { month: input.month, amount: input.amount },
      };
    },
  );
}

export async function clearMonthlyBudgetMutation(
  input: { idempotencyKey: string; month: string },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "delete",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "clear_monthly_budget",
    },
    async (entityId) => {
      const { error } = await context.supabase
        .from("monthly_budgets")
        .delete()
        .eq("user_id", context.userId)
        .eq("month", `${input.month}-01`);
      if (error)
        throw new Error(`Unable to clear monthly budget: ${error.message}`);
      return {
        entityId,
        result: { cleared: true, month: input.month },
      };
    },
  );
}

export async function clearFunMoneyBudgetMutation(
  input: { idempotencyKey: string; month: string },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "set",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "clear_fun_money_budget",
    },
    async (entityId) => {
      const { data: existing, error: loadError } = await context.supabase
        .from("monthly_budgets")
        .select("id")
        .eq("user_id", context.userId)
        .eq("month", `${input.month}-01`)
        .maybeSingle();
      if (loadError)
        throw new Error(
          `Unable to load fun-money budget: ${loadError.message}`,
        );
      if (existing) {
        const { error } = await context.supabase
          .from("monthly_budgets")
          .update({ wants_limit: null })
          .eq("id", existing.id)
          .eq("user_id", context.userId);
        if (error)
          throw new Error(`Unable to clear fun-money budget: ${error.message}`);
      }
      return {
        entityId,
        result: { cleared: true, month: input.month },
      };
    },
  );
}

export async function previewTransactionImport(
  input: { rows: TransactionImportRow[] },
  context: AuthenticatedUserContext,
) {
  const [directory, existing] = await Promise.all([
    context.supabase
      .from("categories")
      .select("id")
      .eq("user_id", context.userId),
    listTransactions({ includeFuture: true, userContext: context }),
  ]);
  if (directory.error) throw new Error("Unable to validate import categories.");
  const [accounts] = await Promise.all([
    context.supabase
      .from("payment_methods")
      .select("id")
      .eq("user_id", context.userId)
      .is("deleted_at", null),
  ]);
  if (accounts.error) throw new Error("Unable to validate import accounts.");
  const categoryIds = new Set((directory.data ?? []).map((item) => item.id));
  const accountIds = new Set((accounts.data ?? []).map((item) => item.id));
  return buildTransactionImportPreview(
    input.rows,
    existing.map((transaction) => ({
      amount: Math.abs(transaction.amount),
      categoryId: transaction.categoryId ?? null,
      date: transaction.date,
      description: transaction.descriptionKey,
      idempotencyKey: transaction.entryIdempotencyKey ?? null,
      notes: transaction.notes,
      paymentAccountId: transaction.paymentMethodId ?? null,
      type: transaction.type,
    })),
    categoryIds,
    accountIds,
  );
}

export async function importTransactionsMutation(
  input: { batchIdempotencyKey: string; rows: TransactionImportRow[] },
  context: AuthenticatedUserContext,
) {
  const preview = await previewTransactionImport({ rows: input.rows }, context);
  if (preview.counts.reject > 0) {
    throw new McpToolError(
      "INVALID_INPUT",
      "导入中有分类或支付账户不属于当前账号，未写入任何交易。",
    );
  }
  const toCreate = preview.rows.filter((row) => row.action === "create");
  return runIdempotent(
    context,
    {
      action: "import",
      idempotencyKey: input.batchIdempotencyKey,
      payload: input,
      toolName: "import_transactions",
    },
    async (entityId) => {
      const { data: batch, error: batchError } = await context.supabase
        .from("transaction_import_batches")
        .insert({
          id: entityId,
          idempotency_key: input.batchIdempotencyKey,
          user_id: context.userId,
        })
        .select("id")
        .maybeSingle();
      if (batchError || !batch) {
        throw new Error("Unable to create transaction import batch.");
      }

      let result = { replayed: false, transactionIds: [] as string[] };
      try {
        if (toCreate.length > 0) {
          result = await createTransactionsBatchWithResult(
            toCreate.map((row) => ({
              amount: row.amount,
              category: row.categoryId ?? "none",
              date: row.date,
              description: row.description,
              idempotencyKey: row.idempotencyKey,
              installmentCount: 1,
              notes: row.notes ?? undefined,
              paymentMethod: row.paymentAccountId ?? "none",
              type: row.type,
            })),
            context,
            { importBatchId: entityId },
          );
        }
      } catch (error) {
        await context.supabase
          .from("transaction_import_batches")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("id", entityId)
          .eq("user_id", context.userId);
        throw error;
      }
      return {
        entityId,
        result: { batchId: entityId, ...result, preview },
      };
    },
  );
}

export async function getTransactionImportBatch(
  input: { batchId: string },
  context: AuthenticatedUserContext,
) {
  const { data: batch, error: batchError } = await context.supabase
    .from("transaction_import_batches")
    .select("id, idempotency_key, status, created_at, updated_at")
    .eq("id", input.batchId)
    .eq("user_id", context.userId)
    .maybeSingle();
  if (batchError) throw new Error("Unable to load transaction import batch.");
  if (!batch) throw new Error("Transaction import batch not found.");

  const { data: rows, error: rowsError } = await context.supabase
    .from("transactions")
    .select("id, amount, deleted_at")
    .eq("import_batch_id", input.batchId)
    .eq("user_id", context.userId);
  if (rowsError) throw new Error("Unable to load transaction import impact.");

  const transactionRows = rows ?? [];
  return {
    batch,
    impact: {
      activeCount: transactionRows.filter((row) => !row.deleted_at).length,
      activeTotal: Number(
        transactionRows
          .filter((row) => !row.deleted_at)
          .reduce((sum, row) => sum + Number(row.amount), 0)
          .toFixed(2),
      ),
      transactionIds: transactionRows.map((row) => row.id),
      totalCount: transactionRows.length,
    },
  };
}

async function setTransactionImportBatchStatus(
  input: { batchId: string; status: "active" | "undone" },
  context: AuthenticatedUserContext,
) {
  const { data: batch, error: batchError } = await context.supabase
    .from("transaction_import_batches")
    .select("id, status")
    .eq("id", input.batchId)
    .eq("user_id", context.userId)
    .maybeSingle();
  if (batchError) throw new Error("Unable to load transaction import batch.");
  if (!batch) throw new Error("Transaction import batch not found.");
  if (batch.status === "failed")
    throw new Error("Transaction import batch failed.");

  const update =
    input.status === "undone"
      ? await context.supabase
          .from("transactions")
          .update({ deleted_at: new Date().toISOString() })
          .eq("import_batch_id", input.batchId)
          .eq("user_id", context.userId)
          .is("deleted_at", null)
      : await context.supabase
          .from("transactions")
          .update({ deleted_at: null })
          .eq("import_batch_id", input.batchId)
          .eq("user_id", context.userId);
  if (update.error)
    throw new Error("Unable to update transaction import rows.");

  const { error } = await context.supabase
    .from("transaction_import_batches")
    .update({ status: input.status, updated_at: new Date().toISOString() })
    .eq("id", input.batchId)
    .eq("user_id", context.userId);
  if (error) throw new Error("Unable to update transaction import batch.");
  const verified = await getTransactionImportBatch(
    { batchId: input.batchId },
    context,
  );
  const expectedActiveCount =
    input.status === "active" ? verified.impact.totalCount : 0;
  if (
    verified.batch.status !== input.status ||
    verified.impact.activeCount !== expectedActiveCount
  ) {
    throw new Error("Unable to verify transaction import batch state.");
  }
}

export async function undoTransactionImport(
  input: { batchId: string; idempotencyKey: string },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "delete",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "undo_transaction_import",
    },
    async () => {
      await setTransactionImportBatchStatus(
        { batchId: input.batchId, status: "undone" },
        context,
      );
      return { entityId: input.batchId, result: { batchId: input.batchId } };
    },
  );
}

export async function restoreTransactionImport(
  input: { batchId: string; idempotencyKey: string },
  context: AuthenticatedUserContext,
) {
  return runIdempotent(
    context,
    {
      action: "restore",
      idempotencyKey: input.idempotencyKey,
      payload: input,
      toolName: "restore_transaction_import",
    },
    async () => {
      await setTransactionImportBatchStatus(
        { batchId: input.batchId, status: "active" },
        context,
      );
      return { entityId: input.batchId, result: { batchId: input.batchId } };
    },
  );
}
