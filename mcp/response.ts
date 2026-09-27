import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

export const mcpErrorCodeSchema = z.enum([
  "INVALID_INPUT",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR",
]);

export const mcpResponseSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z
    .object({
      code: mcpErrorCodeSchema,
      message: z.string(),
    })
    .optional(),
});

export type McpErrorCode = z.infer<typeof mcpErrorCodeSchema>;

export class McpToolError extends Error {
  readonly code: McpErrorCode;

  constructor(code: McpErrorCode, message: string) {
    super(message);
    this.name = "McpToolError";
    this.code = code;
  }
}

export function toolSuccess<T>(data: T): CallToolResult {
  const payload = { data, ok: true };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

export function toolFailure(
  code: McpErrorCode,
  message: string,
): CallToolResult {
  const payload = { error: { code, message }, ok: false };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError: true,
    structuredContent: payload,
  };
}

export function toMcpToolError(
  error: unknown,
  fallbackMessage = "CatWallet could not complete this read request.",
) {
  if (error instanceof McpToolError) return error;
  return new McpToolError("INTERNAL_ERROR", fallbackMessage);
}
