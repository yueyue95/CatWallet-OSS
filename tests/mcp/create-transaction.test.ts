import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";

import {
  createTransactionMutation,
  createTransactionSchema,
  deriveMcpTransactionId,
  type McpMutationDependencies,
} from "@/mcp/mutations";
import { createStaticMcpAuthProvider } from "@/mcp/auth/context";
import { sha256 } from "@/mcp/idempotency";
import { McpToolError } from "@/mcp/response";
import { createMcpServer } from "@/mcp/server";
import type { AuthenticatedUserContext } from "@/lib/finance/transactions";
import type { Transaction } from "@/lib/data";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const CATEGORY_ID = "33333333-3333-4333-8333-333333333333";
const PAYMENT_ACCOUNT_ID = "44444444-4444-4444-8444-444444444444";

function context(userId = USER_A) {
  return {
    claims: { sub: userId },
    createdAt: "2026-09-01T00:00:00.000Z",
    supabase: {} as AuthenticatedUserContext["supabase"],
    user: { id: userId } as AuthenticatedUserContext["user"],
    userId,
  } satisfies AuthenticatedUserContext;
}

function transaction(
  id: string,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    amount: -80,
    categoryId: CATEGORY_ID,
    categoryKey: "Groceries",
    countsTowardFunMoney: false,
    date: "2026-09-17",
    descriptionKey: "Groceries",
    fixedCommitmentId: null,
    group: "needs",
    icon: "🛒",
    id,
    installmentAmount: null,
    installmentAmountMode: null,
    installmentCurrentNumber: null,
    installmentGroupId: null,
    installmentNumber: null,
    installmentTotal: null,
    isCreditCardInvoice: false,
    isCreditCardInvoicePurchase: false,
    isPlanned: false,
    notes: null,
    paymentMethodClosingDay: null,
    paymentMethodDueDay: null,
    paymentMethodId: PAYMENT_ACCOUNT_ID,
    paymentMethodKey: "Bank",
    paymentMethodType: "bank",
    type: "expense",
    ...overrides,
  };
}

function validInput(idempotencyKey = "mcp-fixture-1") {
  return {
    amount: 80,
    categoryId: CATEGORY_ID,
    countsTowardFunMoney: false,
    date: "2026-09-17",
    description: "Groceries",
    idempotencyKey,
    paymentAccountId: PAYMENT_ACCOUNT_ID,
    type: "expense" as const,
  };
}

function dependencies() {
  const registry = new Map<
    string,
    { entityId: string | null; payloadHash: string; status: string }
  >();
  const audit = new Map<
    string,
    { entityId: string; requestFingerprint: string }
  >();
  const rows = new Map<string, Transaction>();
  const create = vi.fn(async (input, userContext) => {
    const id = deriveMcpTransactionId(
      userContext.userId,
      input.idempotencyKey ?? "",
    );
    const existing = rows.get(`${userContext.userId}:${id}`);
    if (existing) return { replayed: true, transactionId: existing.id };
    rows.set(
      `${userContext.userId}:${id}`,
      transaction(id, {
        amount: input.type === "income" ? input.amount : -input.amount,
        categoryId: input.category === "none" ? null : input.category,
        categoryKey: input.category === "none" ? "expense" : "Groceries",
        countsTowardFunMoney: input.countsTowardFunMoney === true,
        date: input.date,
        descriptionKey: input.description,
        paymentMethodId:
          input.paymentMethod === "none" ? null : input.paymentMethod,
        type: input.type,
      }),
    );
    return { replayed: false, transactionId: id };
  });
  const deps: McpMutationDependencies = {
    claimIdempotency: vi.fn(async (userContext, input) => {
      const idempotencyKeyHash = sha256(input.idempotencyKey);
      const registryKey = `${userContext.userId}:${input.toolName}:${idempotencyKeyHash}`;
      const existing = registry.get(registryKey);
      if (!existing) {
        registry.set(registryKey, {
          entityId: null,
          payloadHash: input.payloadHash,
          status: "pending",
        });
        return { entityId: null, idempotencyKeyHash, replayed: false };
      }
      if (existing.payloadHash !== input.payloadHash) {
        throw new McpToolError(
          "CONFLICT",
          "这个幂等键已经用于另一项不同的请求。请使用新的幂等键。",
        );
      }
      if (existing.status !== "succeeded" || !existing.entityId) {
        throw new McpToolError(
          "CONFLICT",
          "相同的管家请求正在处理中，请稍后重试。",
        );
      }
      return {
        entityId: existing.entityId,
        idempotencyKeyHash,
        replayed: true,
      };
    }),
    completeIdempotency: vi.fn(async (userContext, input) => {
      const registryKey = `${userContext.userId}:create_transaction:${input.idempotencyKeyHash}`;
      const existing = registry.get(registryKey);
      if (existing) {
        existing.entityId = input.entityId;
        existing.status = "succeeded";
      }
    }),
    createTransaction: create,
    failIdempotency: vi.fn(async (userContext, input) => {
      const registryKey = `${userContext.userId}:create_transaction:${input.idempotencyKeyHash}`;
      const existing = registry.get(registryKey);
      if (existing) existing.status = "failed";
    }),
    getTransactionById: vi.fn(async (id, userContext) => {
      const row = rows.get(`${userContext.userId}:${id}`);
      if (!row) throw new Error("Transaction not found.");
      return row;
    }),
    recordAudit: vi.fn(async (userContext, record) => {
      if (record.success && record.entityId) {
        audit.set(`${userContext.userId}:${record.idempotencyKeyHash}`, {
          entityId: record.entityId,
          requestFingerprint: record.requestFingerprint,
        });
      }
      return true;
    }),
  };
  return { audit, deps, registry, rows, create };
}

describe("create_transaction MCP mutation", () => {
  it("creates one transaction and returns the normalized resolved result", async () => {
    const { deps, create } = dependencies();

    const result = await createTransactionMutation(
      validInput(),
      context(),
      deps,
    );

    expect(result).toMatchObject({
      idempotencyResult: "created",
      transaction: {
        amount: 80,
        category: { id: CATEGORY_ID, key: "Groceries" },
        countsTowardFunMoney: false,
        coolingItemId: null,
        date: "2026-09-17",
        description: "Groceries",
        fixedCommitmentId: null,
        id: expect.any(String),
        paymentAccount: { id: PAYMENT_ACCOUNT_ID, key: "Bank" },
        type: "expense",
      },
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("accepts a historical transaction date without changing the MCP contract", async () => {
    const { deps, create } = dependencies();

    const result = await createTransactionMutation(
      { ...validInput("historical-date-key"), date: "2026-08-31" },
      context(),
      deps,
    );

    expect(result.transaction.date).toBe("2026-08-31");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ date: "2026-08-31" }),
      expect.anything(),
    );
  });

  it("returns the same structured contract through a real MCP client transport", async () => {
    const { deps } = dependencies();
    const server = createMcpServer({
      auth: createStaticMcpAuthProvider(context()),
      mutationDependencies: deps,
    });
    const client = new Client({
      name: "catwallet-test-client",
      version: "1.0.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "create_transaction",
      arguments: validInput("mcp-transport-key"),
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      data: { idempotencyResult: "created" },
      ok: true,
    });
  });

  it("replays the first result for the same user and key without creating again", async () => {
    const { deps, create } = dependencies();
    const first = await createTransactionMutation(
      validInput("retry-key"),
      context(USER_A),
      deps,
    );
    const second = await createTransactionMutation(
      validInput("retry-key"),
      context(USER_A),
      deps,
    );

    expect(first.transaction.id).toBe(second.transaction.id);
    expect(first.idempotencyResult).toBe("created");
    expect(second.idempotencyResult).toBe("replayed");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not collide when different users use the same key", async () => {
    const { deps, create } = dependencies();
    const first = await createTransactionMutation(
      validInput("same-key"),
      context(USER_A),
      deps,
    );
    const second = await createTransactionMutation(
      validInput("same-key"),
      context(USER_B),
      deps,
    );

    expect(first.transaction.id).not.toBe(second.transaction.id);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("rejects a different payload with the same user-scoped key", async () => {
    const { deps, create } = dependencies();
    await createTransactionMutation(
      validInput("conflict-key"),
      context(),
      deps,
    );

    await expect(
      createTransactionMutation(
        { ...validInput("conflict-key"), amount: 81 },
        context(),
        deps,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["negative amount", { amount: -1 }],
    ["invalid type", { type: "transfer" }],
    ["invalid date", { date: "2026-02-30" }],
    ["fun money on income", { type: "income", countsTowardFunMoney: true }],
    ["fun money on saving", { type: "saving", countsTowardFunMoney: true }],
    ["unknown field", { userId: USER_A }],
  ])("rejects %s with structured validation error", async (_label, patch) => {
    const { deps, create } = dependencies();

    await expect(
      createTransactionMutation({ ...validInput(), ...patch }, context(), deps),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(create).not.toHaveBeenCalled();
  });

  it.each(["categoryId", "paymentAccountId"])(
    "rejects a missing %s instead of guessing an account reference",
    async (field) => {
      const { deps, create } = dependencies();
      const input = { ...validInput() };
      delete input[field as keyof typeof input];

      await expect(
        createTransactionMutation(input, context(), deps),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("records a failed create without returning a success or half-created result", async () => {
    const { deps, create } = dependencies();
    create.mockRejectedValueOnce(new Error("Unable to save transaction: db"));

    await expect(
      createTransactionMutation(validInput(), context(), deps),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(deps.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_A }),
      expect.objectContaining({ success: false, entityId: null }),
    );
  });

  it("never stores the raw idempotency key in the audit record", async () => {
    const { deps } = dependencies();
    const secretLikeKey = "do-not-log-this-key";

    await createTransactionMutation(validInput(secretLikeKey), context(), deps);

    const record = vi.mocked(deps.recordAudit).mock.calls[0][1];
    expect(JSON.stringify(record)).not.toContain(secretLikeKey);
    expect(record.idempotencyKeyHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not accept a caller-supplied userId", () => {
    expect(() =>
      createTransactionSchema.parse({ ...validInput(), userId: USER_A }),
    ).toThrow();
  });
});
