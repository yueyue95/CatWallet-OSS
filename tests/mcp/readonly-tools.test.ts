import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";

import { createStaticMcpAuthProvider } from "@/mcp/auth/context";
import { McpToolError } from "@/mcp/response";
import { createReadOnlyMcpServer } from "@/mcp/server";
import type { McpReadModels } from "@/mcp/services";
import type { AuthenticatedUserContext } from "@/lib/finance/transactions";
import type { Transaction } from "@/lib/data";

const USER_A = "11111111-1111-4111-8111-111111111111";

function context(
  userId = USER_A,
  supabase: AuthenticatedUserContext["supabase"] = {} as AuthenticatedUserContext["supabase"],
) {
  return {
    claims: { sub: userId },
    createdAt: "2026-09-01T00:00:00.000Z",
    supabase,
    user: { id: userId } as AuthenticatedUserContext["user"],
    userId,
  } satisfies AuthenticatedUserContext;
}

function services(): McpReadModels {
  return {
    getAccountBalances: vi.fn().mockResolvedValue([]),
    getTransactionDirectory: vi.fn().mockResolvedValue({
      categories: [
        {
          group: "wants",
          icon: "🍜",
          id: "22222222-2222-4222-8222-222222222222",
          isDefault: true,
          name: "Food",
        },
      ],
      paymentAccounts: [
        {
          closingDay: null,
          dueDay: null,
          id: "44444444-4444-4444-8444-444444444444",
          name: "Bank",
          type: "bank",
        },
      ],
    }),
    getDashboard: vi.fn().mockResolvedValue({
      fixedCommitments: [],
      month: "2026-09",
      safeToSpend: {
        dataQuality: "verified",
        fixedCommitments: 500,
        futureReserves: 100,
        income: 2000,
        incomeIsForecast: false,
        longTermSavings: 200,
        monthlyReserve: 300,
        paidFixedCommitments: 0,
        regularSpent: 300,
        safeToSpend: 900,
        spent: 300,
        unpaidDueCommitments: 0,
        unprepaidDailySpent: 300,
      },
      sinkingFunds: [],
    }),
    getFunMoney: vi.fn().mockResolvedValue({
      budget: 300,
      budgetSet: true,
      isOverBudget: false,
      month: "2026-09",
      overAmount: 0,
      percentage: 16.67,
      remaining: 250,
      spent: 50,
    }),
    getInstallments: vi.fn().mockResolvedValue([]),
    getMonthlyReport: vi.fn().mockResolvedValue({
      core: {
        actualExpenses: 300,
        fixedCommitments: 500,
        funMoney: { budget: 300, percentage: 16.67, remaining: 250, spent: 50 },
        income: 2000,
        longTermSavings: 200,
        netBalance: 1500,
        safeToSpend: 900,
        sinkingFundReserve: 100,
      },
      month: "2026-09",
      spendingByCategory: [],
      specialSpending: { fixedCommitments: 0, funMoney: 50 },
      topExpenses: [],
      largeOneTimeExpenses: [],
      installments: { active: [], endingThisMonth: [], endingNextMonth: [] },
      sinkingFunds: [],
      cooling: {
        addedCount: 0,
        abandonedAmount: 0,
        abandonedCount: 0,
        purchasedCount: 0,
      },
    }),
    getSafeToSpend: vi.fn().mockResolvedValue({
      fixedCommitments: [],
      month: "2026-09",
      safeToSpend: {
        dataQuality: "verified",
        incomeIsForecast: false,
        fixedCommitments: 500,
        futureReserves: 100,
        income: 2000,
        longTermSavings: 200,
        monthlyReserve: 300,
        paidFixedCommitments: 0,
        regularSpent: 300,
        safeToSpend: 900,
        spent: 300,
        unpaidDueCommitments: 0,
        unprepaidDailySpent: 300,
      },
      sinkingFunds: [],
    }),
    listCoolingItems: vi.fn().mockResolvedValue([]),
    listFixedCommitments: vi.fn().mockResolvedValue([]),
    listGoals: vi.fn().mockResolvedValue([]),
    listSinkingFunds: vi.fn().mockResolvedValue([]),
    listTransactions: vi.fn().mockResolvedValue([]),
  };
}

async function connectServer(readModels = services(), authContext = context()) {
  const server = createReadOnlyMcpServer({
    auth: createStaticMcpAuthProvider(authContext),
    readModels,
  });
  const client = new Client({
    name: "catwallet-test-client",
    version: "1.0.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, readModels, server };
}

function responseData(result: Awaited<ReturnType<Client["callTool"]>>) {
  expect(result.isError).not.toBe(true);
  return (result.structuredContent as { data: unknown }).data;
}

describe("CatWallet read-only MCP tools", () => {
  it("exposes the deployed read and write capability surface without a user selector", async () => {
    const { client } = await connectServer();
    const result = await client.listTools();

    expect(result.tools.map((tool) => tool.name)).toEqual([
      "get_capabilities",
      "get_dashboard_summary",
      "preview_delete_installment",
      "preview_account_transfer",
      "get_safe_to_spend",
      "list_categories",
      "list_payment_accounts",
      "get_account_balances",
      "list_transactions",
      "list_installments",
      "get_installment_summary",
      "list_sinking_funds",
      "list_fixed_commitments",
      "list_goals",
      "get_goal",
      "get_monthly_report",
      "list_cooling_items",
      "create_installment",
      "update_installment",
      "record_installment_payment",
      "complete_installment",
      "delete_installment",
      "restore_installment",
      "create_account_transfer",
      "update_account_transfer",
      "delete_account_transfer",
      "restore_account_transfer",
      "create_reimbursement",
      "create_transaction",
      "create_payment_account",
      "update_payment_account",
      "set_opening_balance",
      "add_balance_adjustment",
      "delete_payment_account",
      "update_transaction",
      "delete_transaction",
      "restore_transaction",
      "create_category",
      "update_category",
      "archive_category",
      "delete_category",
      "create_fixed_commitment",
      "update_fixed_commitment",
      "disable_fixed_commitment",
      "record_fixed_commitment_payment",
      "create_goal",
      "update_goal",
      "record_goal_fund_entry",
      "delete_goal",
      "create_sinking_fund",
      "update_sinking_fund",
      "archive_sinking_fund",
      "record_sinking_fund_entry",
      "create_cooling_item",
      "update_cooling_item",
      "delete_cooling_item",
      "set_cooling_item_status",
      "set_monthly_budget",
      "clear_monthly_budget",
      "clear_fun_money_budget",
      "set_fun_money_budget",
      "preview_transaction_import",
      "import_transactions",
      "get_transaction_import_batch",
      "undo_transaction_import",
      "restore_transaction_import",
    ]);
    const importTool = result.tools.find(
      (tool) => tool.name === "import_transactions",
    );
    expect(importTool?.inputSchema).toMatchObject({
      properties: {
        rows: {
          items: {
            properties: {
              idempotencyKey: { format: "uuid" },
            },
          },
        },
      },
    });
    expect(
      result.tools.every((tool) => !tool.inputSchema.properties?.userId),
    ).toBe(true);
    expect(
      result.tools.find((tool) => tool.name === "create_transaction"),
    ).toMatchObject({
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        readOnlyHint: false,
      },
    });
    expect(
      result.tools.every(
        (tool) =>
          (tool._meta?.securitySchemes as Array<{ type: string }>)[0].type ===
          "oauth2",
      ),
    ).toBe(true);
  });

  it("calls every tool through the authenticated user's existing read models", async () => {
    const { client, readModels } = await connectServer();
    const calls = [
      ["get_capabilities", {}],
      ["get_dashboard_summary", { month: "2026-09" }],
      ["get_safe_to_spend", { month: "2026-09" }],
      ["list_categories", {}],
      ["list_payment_accounts", {}],
      ["get_account_balances", {}],
      ["list_transactions", { month: "2026-09", limit: 10 }],
      ["list_installments", { status: "all" }],
      ["get_installment_summary", { month: "2026-09" }],
      ["list_sinking_funds", { active: true }],
      ["list_fixed_commitments", { month: "2026-09", active: true }],
      ["list_goals", { active: true }],
      ["get_monthly_report", { month: "2026-09" }],
      ["list_cooling_items", { status: "all" }],
    ] as const;

    for (const [name, args] of calls) {
      const result = await client.callTool({ name, arguments: args });
      expect(responseData(result)).toBeDefined();
    }

    expect(readModels.getDashboard).toHaveBeenCalled();
    expect(readModels.getTransactionDirectory).toHaveBeenCalledTimes(2);
    expect(readModels.getAccountBalances).toHaveBeenCalled();
    expect(readModels.getFunMoney).toHaveBeenCalled();
    expect(readModels.getSafeToSpend).toHaveBeenCalled();
    expect(readModels.getMonthlyReport).toHaveBeenCalled();
    expect(readModels.getMonthlyReport).toHaveBeenCalledWith(
      USER_A,
      "2026-09",
      expect.objectContaining({ userId: USER_A }),
    );
    expect(readModels.getInstallments).toHaveBeenCalled();
    expect(readModels.listSinkingFunds).toHaveBeenCalled();
    expect(readModels.listFixedCommitments).toHaveBeenCalled();
    expect(readModels.listGoals).toHaveBeenCalled();
    expect(readModels.listTransactions).toHaveBeenCalled();
    expect(readModels.listCoolingItems).toHaveBeenCalled();

    expect(readModels.getDashboard).toHaveBeenCalledWith(
      "2026-09",
      expect.objectContaining({ userId: USER_A }),
    );
  });

  it("reports the deployed write surface without exposing an arbitrary user selector", async () => {
    const { client } = await connectServer();
    const result = await client.callTool({
      name: "get_capabilities",
      arguments: {},
    });

    expect(responseData(result)).toMatchObject({
      apiVersion: "2026-09-21",
      authentication: "request_scoped_oauth_session",
      userIdParameterAllowed: false,
      writes: expect.arrayContaining([
        expect.objectContaining({
          idempotencyRequired: true,
          name: "create_transaction",
          status: "available",
        }),
      ]),
    });
  });

  it("returns stable IDs and readable names from the existing transaction directory", async () => {
    const { client } = await connectServer();

    const categories = responseData(
      await client.callTool({ name: "list_categories", arguments: {} }),
    );
    const paymentAccounts = responseData(
      await client.callTool({
        name: "list_payment_accounts",
        arguments: {},
      }),
    );

    expect(categories).toEqual({
      items: [
        expect.objectContaining({
          id: "22222222-2222-4222-8222-222222222222",
          name: "Food",
        }),
      ],
    });
    expect(paymentAccounts).toEqual({
      items: [
        expect.objectContaining({
          id: "44444444-4444-4444-8444-444444444444",
          name: "Bank",
        }),
      ],
    });
  });

  it("returns stable data contracts for the dashboard, safe-to-spend, and monthly report", async () => {
    const { client } = await connectServer();

    const dashboard = responseData(
      await client.callTool({
        name: "get_dashboard_summary",
        arguments: { month: "2026-09" },
      }),
    );
    const safeToSpend = responseData(
      await client.callTool({
        name: "get_safe_to_spend",
        arguments: { month: "2026-09" },
      }),
    );
    const report = responseData(
      await client.callTool({
        name: "get_monthly_report",
        arguments: { month: "2026-09" },
      }),
    );

    expect(dashboard).toMatchObject({
      month: "2026-09",
      safeToSpend: { safeToSpend: 900 },
    });
    expect(safeToSpend).toMatchObject({
      safeToSpend: 900,
      fixedCommitments: 500,
    });
    expect(report).toMatchObject({
      month: "2026-09",
      core: { netBalance: 1500, safeToSpend: 900 },
    });
    expect(report.core).not.toHaveProperty("cashflowShortfall");
  });

  it("rejects invalid inputs before the read model is called", async () => {
    const readModels = services();
    const { client } = await connectServer(readModels);

    const result = await client.callTool({
      name: "list_transactions",
      arguments: { month: "September 2026", limit: 0 },
    });

    expect(result.isError).toBe(true);
    expect(readModels.listTransactions).not.toHaveBeenCalled();
  });

  it("returns an INVALID_INPUT amount path for invalid installment values", async () => {
    const supabase = { from: vi.fn(), rpc: vi.fn() };
    const { client } = await connectServer(
      services(),
      context(USER_A, supabase as never),
    );
    const result = await client.callTool({
      name: "create_installment",
      arguments: {
        amount: 0.001,
        amountMode: "per_installment",
        categoryId: "22222222-2222-4222-8222-222222222222",
        currentInstallment: 1,
        date: "2026-09-26",
        description: "Invalid sub-cent amount",
        idempotencyKey: "invalid-installment-amount",
        paymentAccountId: "44444444-4444-4444-8444-444444444444",
        totalInstallments: 2,
      },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: "INVALID_INPUT" },
      ok: false,
    });
    expect(
      (result.structuredContent as { error: { message: string } }).error
        .message,
    ).toContain("amount");
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("reads archived commitments and sinking funds with active:false", async () => {
    const readModels = services();
    vi.mocked(readModels.listFixedCommitments).mockResolvedValue([
      {
        amount: 0.14,
        cadence: "monthly",
        categoryId: null,
        categoryName: null,
        customIntervalMonths: null,
        endDate: null,
        archivedAt: "2026-09-25T00:00:00Z",
        id: "22222222-2222-4222-8222-222222222222",
        includeInSafeToSpend: true,
        isEnabled: false,
        name: "Archived commitment",
        paymentMethodId: null,
        paymentMethodName: null,
        startDate: "2026-10-01",
      },
      {
        amount: 0.13,
        cadence: "monthly",
        categoryId: null,
        categoryName: null,
        customIntervalMonths: null,
        endDate: null,
        id: "55555555-5555-4555-8555-555555555555",
        includeInSafeToSpend: true,
        isEnabled: false,
        name: "Disabled commitment",
        paymentMethodId: null,
        paymentMethodName: null,
        startDate: "2026-10-01",
      },
    ]);
    vi.mocked(readModels.listSinkingFunds).mockResolvedValue([
      {
        currentAmount: 0,
        archivedAt: "2026-09-25T00:00:00Z",
        emoji: "🐱",
        expectedUseDate: null,
        id: "33333333-3333-4333-8333-333333333333",
        isEnabled: false,
        monthlyTarget: 0,
        name: "Archived fund",
        notes: null,
        targetAmount: null,
      },
      {
        currentAmount: 0,
        emoji: "🐱",
        expectedUseDate: null,
        id: "66666666-6666-4666-8666-666666666666",
        isEnabled: false,
        monthlyTarget: 0,
        name: "Disabled fund",
        notes: null,
        targetAmount: null,
      },
    ]);
    const { client } = await connectServer(readModels);

    const commitments = responseData(
      await client.callTool({
        name: "list_fixed_commitments",
        arguments: { active: false, month: "2026-10" },
      }),
    ) as { items: unknown[] };
    const funds = responseData(
      await client.callTool({
        name: "list_sinking_funds",
        arguments: { active: false },
      }),
    ) as { items: unknown[] };

    expect(commitments.items).toHaveLength(2);
    expect(funds.items).toHaveLength(2);
    expect(commitments.items[0]).toMatchObject({ lifecycleStatus: "archived" });
    expect(funds.items[0]).toMatchObject({ lifecycleStatus: "archived" });
    expect(commitments.items[1]).toMatchObject({ lifecycleStatus: "disabled" });
    expect(funds.items[1]).toMatchObject({ lifecycleStatus: "disabled" });
    expect(readModels.listFixedCommitments).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_A }),
      { includeArchived: true },
    );
    expect(readModels.listSinkingFunds).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_A }),
      { includeArchived: true },
    );
  });

  it("exposes owner-scoped goal readback, including archived goals", async () => {
    const readModels = services();
    vi.mocked(readModels.listGoals).mockResolvedValue([
      {
        color: "blue",
        currentAmount: 5,
        deadline: "2026-12-01",
        icon: "star",
        id: "33333333-3333-4333-8333-333333333333",
        name: "Archived goal",
        targetAmount: 10,
        archivedAt: "2026-09-25T00:00:00Z",
      },
    ]);
    const { client } = await connectServer(readModels);

    const result = responseData(
      await client.callTool({
        name: "list_goals",
        arguments: { active: false },
      }),
    ) as { items: Array<{ id: string; currentAmount: number }> };

    expect(result.items).toEqual([
      expect.objectContaining({
        id: "33333333-3333-4333-8333-333333333333",
        currentAmount: 5,
        lifecycleStatus: "archived",
      }),
    ]);
    expect(readModels.listGoals).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_A }),
      { includeArchived: true },
    );

    const one = responseData(
      await client.callTool({
        name: "get_goal",
        arguments: { id: "33333333-3333-4333-8333-333333333333" },
      }),
    ) as { item: { id: string } };
    expect(one.item.id).toBe("33333333-3333-4333-8333-333333333333");
    expect(one.item).toMatchObject({ lifecycleStatus: "archived" });

    const missing = await client.callTool({
      name: "get_goal",
      arguments: { id: "44444444-4444-4444-8444-444444444444" },
    });
    expect(missing.isError).toBe(true);
  });

  it("passes bounded pagination and all supported transaction filters to the read model", async () => {
    const readModels = services();
    vi.mocked(readModels.listTransactions).mockResolvedValue(
      Array.from(
        { length: 3 },
        (_, index) =>
          ({
            amount: index + 1,
            categoryKey: "food",
            categoryId: "22222222-2222-4222-8222-222222222222",
            date: `2026-09-${String(index + 1).padStart(2, "0")}`,
            descriptionKey: `transaction-${index}`,
            group: "needs",
            icon: "receipt",
            id: `33333333-3333-4333-8333-33333333333${index}`,
            paymentMethodId: "44444444-4444-4444-8444-444444444444",
            paymentMethodKey: "bank",
            type: "expense",
          }) satisfies Transaction,
      ),
    );
    const { client } = await connectServer(readModels);

    const result = await client.callTool({
      name: "list_transactions",
      arguments: {
        categoryId: "22222222-2222-4222-8222-222222222222",
        cursor: "2",
        from: "2026-09-01",
        limit: 2,
        paymentAccountId: "44444444-4444-4444-8444-444444444444",
        to: "2026-09-30",
        type: "expense",
      },
    });
    const data = responseData(result) as {
      items: unknown[];
      nextCursor: string | null;
    };

    expect(data.items).toHaveLength(2);
    expect(data.nextCursor).toBe("4");
    expect(readModels.listTransactions).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryId: "22222222-2222-4222-8222-222222222222",
        from: "2026-09-01",
        limit: 3,
        offset: 2,
        paymentMethodId: "44444444-4444-4444-8444-444444444444",
        to: "2026-09-30",
        type: "expense",
      }),
      expect.objectContaining({ userId: USER_A }),
    );
  });

  it("rejects a caller-supplied userId instead of allowing cross-user selection", async () => {
    const readModels = services();
    const { client } = await connectServer(readModels);

    const result = await client.callTool({
      name: "list_transactions",
      arguments: {
        userId: "55555555-5555-4555-8555-555555555555",
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(readModels.listTransactions).not.toHaveBeenCalled();
  });

  it("leaves guarded database state unchanged because the Stage 9A registry is read-only", async () => {
    const state = { rowCount: 9, version: "before" };
    const mutationMethods = new Set(["delete", "insert", "update", "upsert"]);
    const guardedBuilder = new Proxy(
      {},
      {
        get(_target, property: string) {
          if (mutationMethods.has(property)) {
            return () => {
              state.rowCount += 1;
            };
          }
          return () => guardedBuilder;
        },
      },
    );
    const guardedSupabase = new Proxy(
      {},
      {
        get(_target, property: string) {
          if (property === "from" || property === "rpc") {
            return () => guardedBuilder;
          }
          return undefined;
        },
      },
    ) as AuthenticatedUserContext["supabase"];
    const before = { ...state };
    const { client } = await connectServer(
      services(),
      context(USER_A, guardedSupabase),
    );

    const result = await client.callTool({
      name: "get_dashboard_summary",
      arguments: { month: "2026-09" },
    });

    expect(responseData(result)).toBeDefined();
    expect(state).toEqual(before);
  });

  it("returns an unauthenticated error without accessing read models", async () => {
    const readModels = services();
    const server = createReadOnlyMcpServer({
      auth: {
        getContext: vi
          .fn()
          .mockRejectedValue(
            new McpToolError("UNAUTHENTICATED", "Authentication required."),
          ),
      },
      readModels,
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
      name: "get_safe_to_spend",
      arguments: { month: "2026-09" },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: {
        code: "UNAUTHENTICATED",
      },
      ok: false,
    });
    expect(readModels.getDashboard).not.toHaveBeenCalled();
  });

  it("returns a safe internal error envelope without exposing the underlying error", async () => {
    const readModels = services();
    vi.mocked(readModels.getSafeToSpend).mockRejectedValue(
      new Error("database secret should not cross the MCP boundary"),
    );
    const { client } = await connectServer(readModels);

    const result = await client.callTool({
      name: "get_safe_to_spend",
      arguments: { month: "2026-09" },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "CatWallet could not complete this read request.",
      },
      ok: false,
    });
    expect(result.content[0]).not.toMatchObject({
      text: expect.stringContaining("database secret"),
    });
  });
});
