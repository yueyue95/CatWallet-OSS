import { createHash } from "node:crypto";

import type { AuthenticatedUserContext } from "@/lib/finance/transactions";
import { McpToolError } from "@/mcp/response";

export type McpIdempotencyCheck = {
  idempotencyKeyHash: string;
  replayed: boolean;
  entityId: string | null;
};

export type McpIdempotencyRegistryInput = {
  idempotencyKey: string;
  payloadHash: string;
  toolName: string;
};

export type McpMutationAuditInput = {
  action:
    | "create"
    | "update"
    | "delete"
    | "restore"
    | "set"
    | "adjust"
    | "record"
    | "import";
  entityId?: string | null;
  errorCode?: string | null;
  idempotencyKey: string;
  requestFingerprint: string;
  success: boolean;
  toolName: string;
};

export function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function deriveMcpEntityId(
  userId: string,
  toolName: string,
  idempotencyKey: string,
) {
  const bytes = Buffer.from(
    sha256(`${userId}:${toolName}:${idempotencyKey}`).slice(0, 32),
    "hex",
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function requestFingerprint(value: unknown) {
  return sha256(JSON.stringify(value));
}

export async function claimMcpIdempotency(
  context: AuthenticatedUserContext,
  input: McpIdempotencyRegistryInput,
): Promise<McpIdempotencyCheck> {
  const idempotencyKeyHash = sha256(input.idempotencyKey);
  const { data: inserted, error: insertError } = await context.supabase
    .from("mcp_mutation_idempotency")
    .insert({
      idempotency_key_hash: idempotencyKeyHash,
      payload_hash: input.payloadHash,
      status: "pending",
      tool_name: input.toolName,
      user_id: context.userId,
    })
    .select("result_entity_id")
    .maybeSingle();

  if (!insertError && inserted) {
    return { entityId: null, idempotencyKeyHash, replayed: false };
  }

  if (insertError?.code !== "23505") {
    throw new McpToolError("INTERNAL_ERROR", "无法读取管家操作的幂等记录。");
  }

  const { data: existing, error: readError } = await context.supabase
    .from("mcp_mutation_idempotency")
    .select("payload_hash, result_entity_id, status")
    .eq("user_id", context.userId)
    .eq("tool_name", input.toolName)
    .eq("idempotency_key_hash", idempotencyKeyHash)
    .maybeSingle();

  if (readError || !existing) {
    throw new McpToolError("INTERNAL_ERROR", "无法读取管家操作的幂等记录。");
  }
  if (existing.payload_hash !== input.payloadHash) {
    throw new McpToolError(
      "CONFLICT",
      "这个幂等键已经用于另一项不同的请求。请使用新的幂等键。",
    );
  }
  if (existing.status === "succeeded") {
    return {
      entityId: existing.result_entity_id,
      idempotencyKeyHash,
      replayed: true,
    };
  }
  if (existing.status === "pending") {
    throw new McpToolError(
      "CONFLICT",
      "相同的管家请求正在处理中，请稍后重试。",
    );
  }
  throw new McpToolError(
    "CONFLICT",
    "相同的管家请求上一次未完成，请使用新的幂等键重试。",
  );
}

export async function completeMcpIdempotency(
  context: AuthenticatedUserContext,
  input: {
    entityId: string;
    idempotencyKeyHash: string;
    toolName: string;
  },
) {
  const { data, error } = await context.supabase
    .from("mcp_mutation_idempotency")
    .update({
      result_entity_id: input.entityId,
      status: "succeeded",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", context.userId)
    .eq("tool_name", input.toolName)
    .eq("idempotency_key_hash", input.idempotencyKeyHash)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error || !data) {
    throw new McpToolError("INTERNAL_ERROR", "无法保存管家操作的幂等结果。");
  }
}

export async function failMcpIdempotency(
  context: AuthenticatedUserContext,
  input: {
    idempotencyKeyHash: string;
    toolName: string;
  },
) {
  const { error } = await context.supabase
    .from("mcp_mutation_idempotency")
    .update({
      status: "failed",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", context.userId)
    .eq("tool_name", input.toolName)
    .eq("idempotency_key_hash", input.idempotencyKeyHash)
    .eq("status", "pending");

  if (error) {
    throw new McpToolError("INTERNAL_ERROR", "无法保存管家操作的失败状态。");
  }
}

export async function recordMcpMutationAudit(
  context: AuthenticatedUserContext,
  input: McpMutationAuditInput & { idempotencyKeyHash?: string },
) {
  const idempotencyKeyHash =
    input.idempotencyKeyHash ?? sha256(input.idempotencyKey);
  const { error } = await context.supabase.from("mcp_mutation_audit").insert({
    action: input.action,
    entity_id: input.entityId ?? null,
    error_code: input.success ? null : (input.errorCode ?? "INTERNAL_ERROR"),
    idempotency_key_hash: idempotencyKeyHash,
    request_fingerprint: input.requestFingerprint,
    success: input.success,
    tool_name: input.toolName,
    user_id: context.userId,
  });

  if (error && error.code !== "23505") {
    throw new McpToolError("INTERNAL_ERROR", "无法记录管家操作审计信息。");
  }
}
