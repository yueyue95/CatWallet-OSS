import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  claimMcpIdempotency,
  completeMcpIdempotency,
  recordMcpMutationAudit,
  requestFingerprint,
  deriveMcpEntityId,
  createFixedCommitment,
  updateFixedCommitment,
} = vi.hoisted(() => ({
  claimMcpIdempotency: vi.fn(),
  completeMcpIdempotency: vi.fn(),
  recordMcpMutationAudit: vi.fn(),
  requestFingerprint: vi.fn(),
  deriveMcpEntityId: vi.fn(),
  createFixedCommitment: vi.fn(),
  updateFixedCommitment: vi.fn(),
}));

vi.mock("@/lib/finance/catwallet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/finance/catwallet")>()),
  createFixedCommitment,
  updateFixedCommitment,
}));

vi.mock("@/mcp/idempotency", () => ({
  claimMcpIdempotency,
  completeMcpIdempotency,
  deriveMcpEntityId,
  failMcpIdempotency: vi.fn(),
  recordMcpMutationAudit,
  requestFingerprint,
}));

import {
  createFixedCommitmentMutation,
  deleteTransactionMutation,
  recordSinkingFundEntryMutation,
  setMonthlyBudgetMutation,
  updateFixedCommitmentMutation,
  undoTransactionImport,
} from "@/mcp/butler-mutations";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ENTITY_ID = "22222222-2222-4222-8222-222222222222";

function context() {
  const monthlyBudgets = {
    select: vi.fn(() => monthlyBudgets),
    eq: vi.fn(() => monthlyBudgets),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    upsert: vi.fn().mockResolvedValue({ error: null }),
  };
  return {
    claims: { sub: USER_ID },
    createdAt: "2026-09-22T00:00:00.000Z",
    supabase: {
      from: vi.fn((table: string) => {
        if (table !== "monthly_budgets")
          throw new Error(`Unexpected table: ${table}`);
        return monthlyBudgets;
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
    user: { id: USER_ID },
    userId: USER_ID,
  } as never;
}

describe("Butler budget mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    claimMcpIdempotency.mockResolvedValue({
      entityId: null,
      idempotencyKeyHash: "a".repeat(64),
      replayed: false,
    });
    completeMcpIdempotency.mockResolvedValue(undefined);
    recordMcpMutationAudit.mockResolvedValue(undefined);
    requestFingerprint.mockReturnValue("b".repeat(64));
    deriveMcpEntityId.mockReturnValue(ENTITY_ID);
  });

  it("stores a UUID result entity for monthly budget idempotency", async () => {
    await setMonthlyBudgetMutation(
      {
        idempotencyKey: "budget-key",
        month: "2026-09",
        needsLimit: 100,
      },
      context(),
    );

    expect(completeMcpIdempotency).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityId: ENTITY_ID }),
    );
  });

  it("maps an insufficient sinking-fund balance to a business conflict", async () => {
    const testContext = context() as {
      supabase: { rpc: ReturnType<typeof vi.fn> };
    };
    testContext.supabase.rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        message:
          "Unable to record sinking fund entry: Insufficient sinking fund balance.",
      },
    });

    await expect(
      recordSinkingFundEntryMutation(
        {
          amount: -101,
          entryType: "withdrawal",
          idempotencyKey: "fund-withdrawal-key",
          sinkingFundId: ENTITY_ID,
        },
        testContext as never,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("maps the MCP paymentAccountId on fixed commitment create and update", async () => {
    const input = {
      amount: 0.13,
      cadence: "monthly",
      idempotencyKey: "fixed-create-key",
      name: "Test commitment",
      paymentAccountId: ENTITY_ID,
      startDate: "2026-10-01",
    } as const;
    createFixedCommitment.mockResolvedValue({ id: ENTITY_ID });
    updateFixedCommitment.mockResolvedValue({ id: ENTITY_ID });

    await createFixedCommitmentMutation(input as never, context());
    await updateFixedCommitmentMutation(
      { ...input, amount: 0.14, id: ENTITY_ID } as never,
      context(),
    );

    expect(createFixedCommitment).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethodId: ENTITY_ID }),
      expect.anything(),
    );
    expect(updateFixedCommitment).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethodId: ENTITY_ID }),
      expect.anything(),
    );
  });

  it("does not acknowledge soft deletion before an independent persisted read", async () => {
    const first = {
      eq: vi.fn(),
      is: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: ENTITY_ID },
        error: null,
      }),
      select: vi.fn(),
      update: vi.fn(),
    };
    for (const method of ["eq", "is", "select", "update"] as const) {
      first[method].mockReturnValue(first);
    }
    const second = {
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: ENTITY_ID, deleted_at: null },
        error: null,
      }),
      select: vi.fn(),
    };
    for (const method of ["eq", "select"] as const) {
      second[method].mockReturnValue(second);
    }
    const testContext = context() as {
      supabase: { from: ReturnType<typeof vi.fn> };
    };
    testContext.supabase.from = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);

    await expect(
      deleteTransactionMutation(
        { id: ENTITY_ID, idempotencyKey: "delete-key" },
        testContext as never,
      ),
    ).rejects.toBeDefined();
    expect(testContext.supabase.from).toHaveBeenCalledTimes(2);
    expect(completeMcpIdempotency).not.toHaveBeenCalled();
  });

  it("does not acknowledge batch undo while imported rows remain active", async () => {
    const response = (data: unknown) => {
      const query: Record<string, unknown> = {};
      for (const method of ["eq", "is", "select", "update"] as const) {
        query[method] = vi.fn(() => query);
      }
      query.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
      query.then = (resolve: (value: unknown) => void) =>
        Promise.resolve({ data, error: null }).then(resolve);
      return query;
    };
    const batchId = "33333333-3333-4333-8333-333333333333";
    const queue = [
      response({ id: batchId, status: "active" }),
      response(null),
      response(null),
      response({ id: batchId, status: "undone" }),
      response([{ id: ENTITY_ID, amount: 0.11, deleted_at: null }]),
    ];
    const testContext = context() as {
      supabase: { from: ReturnType<typeof vi.fn> };
    };
    testContext.supabase.from = vi.fn(() => queue.shift());

    await expect(
      undoTransactionImport(
        { batchId, idempotencyKey: "undo-key" },
        testContext as never,
      ),
    ).rejects.toBeDefined();
    expect(completeMcpIdempotency).not.toHaveBeenCalled();
  });
});
