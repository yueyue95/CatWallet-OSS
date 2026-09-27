import { createHash } from "node:crypto";

import { z } from "zod";

import {
  createTransactionWithResult,
  getTransactionById,
  type AuthenticatedUserContext,
  type NewTransactionInput,
} from "@/lib/finance/transactions";
import type { Transaction } from "@/lib/data";
import {
  claimMcpIdempotency,
  completeMcpIdempotency,
  failMcpIdempotency,
  type McpIdempotencyCheck,
  type McpIdempotencyRegistryInput,
} from "@/mcp/idempotency";
import { McpToolError } from "@/mcp/response";

const safeText = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: "text must not contain control characters",
  });

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must use YYYY-MM-DD format")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "date must be a real calendar date");

const opaqueIdempotencyKey = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: "idempotencyKey must not contain control characters",
  });

export const createTransactionSchema = z
  .object({
    amount: z.number().finite().positive().max(1_000_000_000),
    categoryId: z.string().uuid().nullable(),
    countsTowardFunMoney: z.boolean().default(false),
    date,
    description: safeText,
    fixedCommitmentId: z.string().uuid().nullable().optional(),
    idempotencyKey: opaqueIdempotencyKey,
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
    if (
      value.type === "income" &&
      value.categoryId !== undefined &&
      value.categoryId !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "income transactions cannot have a category",
        path: ["categoryId"],
      });
    }
  });

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

type CreateTransactionView = {
  amount: number;
  category: { id: string; key: string } | null;
  countsTowardFunMoney: boolean;
  date: string;
  description: string;
  coolingItemId: string | null;
  fixedCommitmentId: string | null;
  id: string;
  paymentAccount: { id: string; key: string | null } | null;
  type: Transaction["type"];
};

export type McpAuditRecord = {
  action: "create";
  entityId: string | null;
  errorCode: string | null;
  idempotencyKeyHash: string;
  requestFingerprint: string;
  success: boolean;
  toolName: "create_transaction";
};

export type McpMutationDependencies = {
  claimIdempotency: (
    context: AuthenticatedUserContext,
    input: McpIdempotencyRegistryInput,
  ) => Promise<McpIdempotencyCheck>;
  completeIdempotency: (
    context: AuthenticatedUserContext,
    input: {
      entityId: string;
      idempotencyKeyHash: string;
      toolName: string;
    },
  ) => Promise<void>;
  createTransaction: (
    input: NewTransactionInput,
    context: AuthenticatedUserContext,
  ) => Promise<{ replayed: boolean; transactionId: string }>;
  failIdempotency: (
    context: AuthenticatedUserContext,
    input: {
      idempotencyKeyHash: string;
      toolName: string;
    },
  ) => Promise<void>;
  getTransactionById: (
    transactionId: string,
    context: AuthenticatedUserContext,
  ) => Promise<Transaction>;
  recordAudit: (
    context: AuthenticatedUserContext,
    record: McpAuditRecord,
  ) => Promise<boolean>;
};

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function uuidFromHash(hash: string) {
  const bytes = Buffer.from(hash.slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function deriveMcpTransactionId(userId: string, idempotencyKey: string) {
  return uuidFromHash(sha256(`${userId}:${idempotencyKey}`));
}

function requestFingerprint(input: CreateTransactionInput) {
  return sha256(
    JSON.stringify({
      amount: input.amount,
      categoryId: input.categoryId ?? null,
      countsTowardFunMoney: input.countsTowardFunMoney,
      date: input.date,
      description: input.description,
      fixedCommitmentId: input.fixedCommitmentId ?? null,
      paymentAccountId: input.paymentAccountId ?? null,
      type: input.type,
    }),
  );
}

function transactionView(transaction: Transaction): CreateTransactionView {
  return {
    amount: Math.abs(transaction.amount),
    category: transaction.categoryId
      ? { id: transaction.categoryId, key: transaction.categoryKey }
      : null,
    countsTowardFunMoney: transaction.countsTowardFunMoney === true,
    date: transaction.date,
    description: transaction.descriptionKey,
    coolingItemId: null,
    fixedCommitmentId: transaction.fixedCommitmentId ?? null,
    id: transaction.id,
    paymentAccount: transaction.paymentMethodId
      ? {
          id: transaction.paymentMethodId,
          key: transaction.paymentMethodKey ?? null,
        }
      : null,
    type: transaction.type,
  };
}

function fallbackTransactionView(
  input: CreateTransactionInput,
  transactionId: string,
): CreateTransactionView {
  return {
    amount: input.amount,
    category: input.categoryId
      ? { id: input.categoryId, key: input.categoryId }
      : null,
    countsTowardFunMoney: input.countsTowardFunMoney,
    date: input.date,
    description: input.description,
    coolingItemId: null,
    fixedCommitmentId: input.fixedCommitmentId ?? null,
    id: transactionId,
    paymentAccount: input.paymentAccountId
      ? { id: input.paymentAccountId, key: input.paymentAccountId }
      : null,
    type: input.type,
  };
}

function mapCreateError(error: unknown) {
  if (error instanceof McpToolError) return error;
  const message = error instanceof Error ? error.message : "";
  if (/category is invalid/i.test(message)) {
    return new McpToolError("NOT_FOUND", "找不到属于当前账号的分类。");
  }
  if (/payment method is invalid/i.test(message)) {
    return new McpToolError("NOT_FOUND", "找不到属于当前账号的支付账户。");
  }
  if (
    /invalid|must be greater|cannot be earlier|required|too long/i.test(message)
  ) {
    return new McpToolError("INVALID_INPUT", "交易金额、日期或关联字段无效。");
  }
  return new McpToolError("INTERNAL_ERROR", "CatWallet 无法创建这笔交易。");
}

async function recordAuditSafely(
  dependencies: McpMutationDependencies,
  context: AuthenticatedUserContext,
  record: McpAuditRecord,
) {
  try {
    return await dependencies.recordAudit(context, record);
  } catch {
    return false;
  }
}

export async function createTransactionMutation(
  rawInput: unknown,
  context: AuthenticatedUserContext,
  dependencies: McpMutationDependencies = defaultMutationDependencies,
) {
  let input: CreateTransactionInput;
  try {
    input = createTransactionSchema.parse(rawInput);
  } catch (error) {
    throw new McpToolError(
      "INVALID_INPUT",
      error instanceof Error ? error.message : "Transaction input is invalid.",
    );
  }

  const fingerprint = requestFingerprint(input);
  const claim = await dependencies.claimIdempotency(context, {
    idempotencyKey: input.idempotencyKey,
    payloadHash: fingerprint,
    toolName: "create_transaction",
  });
  const idempotencyKeyHash = claim.idempotencyKeyHash;

  if (claim.replayed) {
    if (!claim.entityId) {
      throw new McpToolError(
        "INTERNAL_ERROR",
        "CatWallet idempotency result is missing its transaction reference.",
      );
    }
    const existing = await dependencies.getTransactionById(
      claim.entityId,
      context,
    );
    const auditRecorded = await recordAuditSafely(dependencies, context, {
      action: "create",
      entityId: existing.id,
      errorCode: null,
      idempotencyKeyHash,
      requestFingerprint: fingerprint,
      success: true,
      toolName: "create_transaction",
    });
    return {
      ...(auditRecorded ? {} : { warnings: ["audit_record"] }),
      idempotencyResult: "replayed" as const,
      transaction: transactionView(existing),
    };
  }

  const serviceInput: NewTransactionInput = {
    amount: input.amount,
    category: input.categoryId ?? "none",
    countsTowardFunMoney: input.countsTowardFunMoney,
    date: input.date,
    description: input.description,
    fixedCommitmentId: input.fixedCommitmentId ?? undefined,
    idempotencyKey: deriveMcpTransactionId(
      context.userId,
      input.idempotencyKey,
    ),
    installmentCount: 1,
    paymentMethod: input.paymentAccountId ?? "none",
    type: input.type,
  };

  let created: { replayed: boolean; transactionId: string };
  try {
    created = await dependencies.createTransaction(serviceInput, context);
  } catch (error) {
    try {
      await dependencies.failIdempotency(context, {
        idempotencyKeyHash,
        toolName: "create_transaction",
      });
    } catch {
      // Keep the original business error; idempotency failure must not expose details.
    }
    await recordAuditSafely(dependencies, context, {
      action: "create",
      entityId: null,
      errorCode: mapCreateError(error).code,
      idempotencyKeyHash,
      requestFingerprint: fingerprint,
      success: false,
      toolName: "create_transaction",
    });
    throw mapCreateError(error);
  }

  await dependencies.completeIdempotency(context, {
    entityId: created.transactionId,
    idempotencyKeyHash,
    toolName: "create_transaction",
  });

  let view = fallbackTransactionView(input, created.transactionId);
  const warnings: string[] = [];
  try {
    view = transactionView(
      await dependencies.getTransactionById(created.transactionId, context),
    );
  } catch {
    warnings.push("transaction_read_back");
  }

  const auditRecorded = await recordAuditSafely(dependencies, context, {
    action: "create",
    entityId: created.transactionId,
    errorCode: null,
    idempotencyKeyHash,
    requestFingerprint: fingerprint,
    success: true,
    toolName: "create_transaction",
  });
  if (!auditRecorded) warnings.push("audit_record");

  return {
    ...(warnings.length ? { warnings } : {}),
    idempotencyResult: created.replayed
      ? ("replayed" as const)
      : ("created" as const),
    transaction: view,
  };
}

async function recordAudit(
  context: AuthenticatedUserContext,
  record: McpAuditRecord,
) {
  const { error } = await context.supabase.from("mcp_mutation_audit").insert({
    action: record.action,
    entity_id: record.entityId,
    error_code: record.errorCode,
    idempotency_key_hash: record.idempotencyKeyHash,
    request_fingerprint: record.requestFingerprint,
    success: record.success,
    tool_name: record.toolName,
    user_id: context.userId,
  });
  return !error;
}

const defaultMutationDependencies: McpMutationDependencies = {
  claimIdempotency: claimMcpIdempotency,
  completeIdempotency: completeMcpIdempotency,
  createTransaction: async (input, context) => {
    return createTransactionWithResult(input, context);
  },
  failIdempotency: failMcpIdempotency,
  getTransactionById: (transactionId, context) =>
    getTransactionById(transactionId, context),
  recordAudit,
};
