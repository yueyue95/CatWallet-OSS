import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";

import {
  createCatWalletMcpHttpHandler,
  protectedResourceMetadataResponse,
} from "@/mcp/http";
import type { McpMutationDependencies } from "@/mcp/mutations";
import type { McpReadModels } from "@/mcp/services";
import type { Transaction } from "@/lib/data";
import type { AuthenticatedUserContext } from "@/lib/finance/transactions";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const CATEGORY_ID = "33333333-3333-4333-8333-333333333333";
const PAYMENT_ID = "44444444-4444-4444-8444-444444444444";
const TRANSACTION_ID = "55555555-5555-4555-8555-555555555555";

function context(userId: string): AuthenticatedUserContext {
  return {
    claims: { sub: userId },
    createdAt: "2026-09-01T00:00:00.000Z",
    supabase: {} as AuthenticatedUserContext["supabase"],
    user: { id: userId } as AuthenticatedUserContext["user"],
    userId,
  };
}

function readModels(): McpReadModels {
  return {
    getDashboard: vi.fn(async (month, ctx) => ({
      fixedCommitments: [],
      month,
      owner: ctx.userId,
      safeToSpend: { safeToSpend: 10 },
      sinkingFunds: [],
    })) as McpReadModels["getDashboard"],
    getFunMoney: vi.fn().mockResolvedValue({}),
    getInstallments: vi.fn().mockResolvedValue([]),
    getMonthlyReport: vi.fn(async (_userId, month) => ({ month })),
    getSafeToSpend: vi.fn(async (month) => ({
      fixedCommitments: [],
      month,
      safeToSpend: { safeToSpend: 10 },
      sinkingFunds: [],
    })) as McpReadModels["getSafeToSpend"],
    getTransactionDirectory: vi.fn(async (ctx) => ({
      categories: [
        {
          group: "wants",
          icon: "🍜",
          id: CATEGORY_ID,
          isDefault: false,
          name: `Food ${ctx.userId}`,
        },
      ],
      paymentAccounts: [
        {
          closingDay: null,
          dueDay: null,
          id: PAYMENT_ID,
          name: `Bank ${ctx.userId}`,
          type: "bank",
        },
      ],
    })),
    listCoolingItems: vi.fn().mockResolvedValue([]),
    listFixedCommitments: vi.fn().mockResolvedValue([]),
    listSinkingFunds: vi.fn().mockResolvedValue([]),
    listTransactions: vi.fn().mockResolvedValue([]),
  } as McpReadModels;
}

function mutationDependencies(): McpMutationDependencies {
  const transaction = {
    amount: 12,
    categoryId: CATEGORY_ID,
    categoryKey: "Food",
    countsTowardFunMoney: false,
    date: "2026-09-18",
    descriptionKey: "Lunch",
    group: "wants",
    icon: "🍜",
    id: TRANSACTION_ID,
    paymentMethodId: PAYMENT_ID,
    paymentMethodKey: "Bank",
    type: "expense",
  } as Transaction;
  return {
    claimIdempotency: vi.fn().mockResolvedValue({
      entityId: null,
      idempotencyKeyHash: "a".repeat(64),
      replayed: false,
    }),
    completeIdempotency: vi.fn().mockResolvedValue(undefined),
    createTransaction: vi.fn().mockResolvedValue({
      replayed: false,
      transactionId: TRANSACTION_ID,
    }),
    failIdempotency: vi.fn().mockResolvedValue(undefined),
    getTransactionById: vi.fn().mockResolvedValue(transaction),
    recordAudit: vi.fn().mockResolvedValue(true),
  };
}

function testServer() {
  const reads = readModels();
  const mutations = mutationDependencies();
  const handler = createCatWalletMcpHttpHandler({
    authenticate: async (token) => {
      if (token !== "token-a" && token !== "token-b") throw new Error("bad");
      return {
        context: context(token === "token-a" ? USER_A : USER_B),
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      };
    },
    authorizationServerUrl: new URL("http://localhost:55431/auth/v1"),
    bodyLimitBytes: 1024,
    mcpServerOptions: {
      mutationDependencies: mutations,
      now: () => new Date("2026-08-31T16:30:00.000Z"),
      readModels: reads,
    },
    resourceUrl: new URL("http://localhost:3000/api/mcp"),
    timeZone: "Asia/Kuala_Lumpur",
  });
  return { handler, mutations, reads };
}

function clientFor(
  handler: ReturnType<typeof testServer>["handler"],
  token: string,
) {
  const transport = new StreamableHTTPClientTransport(
    new URL("http://localhost:3000/api/mcp"),
    {
      authProvider: { token: async () => token },
      fetch: async (input, init) =>
        handler.fetch(
          new Request(input, {
            ...init,
            headers: {
              ...Object.fromEntries(new Headers(init?.headers)),
              host: "localhost:3000",
            },
          }),
        ),
    },
  );
  const client = new Client({ name: "http-contract-test", version: "1.0.0" });
  return { client, transport };
}

describe("CatWallet Streamable HTTP contract", () => {
  it("serves protected-resource metadata without secrets", async () => {
    const response = protectedResourceMetadataResponse({
      authorizationServerUrl: new URL("http://localhost:55431/auth/v1"),
      environment: {
        NEXT_PUBLIC_SUPABASE_URL: "http://localhost:55431",
      } as NodeJS.ProcessEnv,
      resourceUrl: new URL("http://localhost:3000/api/mcp"),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    await expect(response.json()).resolves.toEqual({
      authorization_servers: ["http://localhost:55431/auth/v1"],
      bearer_methods_supported: ["header"],
      resource: "http://localhost:3000/api/mcp",
    });
  });

  it("does not require HTTP host/origin allowlists for public metadata", async () => {
    const response = protectedResourceMetadataResponse({
      authorizationServerUrl: new URL(
        "https://catwallet-stage.supabase.co/auth/v1",
      ),
      environment: {
        NODE_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: "https://catwallet-stage.supabase.co",
        CATWALLET_MCP_RESOURCE_URL:
          "https://catwallet-stage.vercel.app/api/mcp",
      } as NodeJS.ProcessEnv,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      authorization_servers: ["https://catwallet-stage.supabase.co/auth/v1"],
      resource: "https://catwallet-stage.vercel.app/api/mcp",
    });
  });

  it("uses the local resource identity when local configuration is absent", async () => {
    const response = protectedResourceMetadataResponse({
      environment: {
        NODE_ENV: "development",
        NEXT_PUBLIC_SUPABASE_URL: "http://localhost:55431",
      } as NodeJS.ProcessEnv,
    });

    await expect(response.json()).resolves.toMatchObject({
      authorization_servers: ["http://localhost:55431/auth/v1"],
      resource: "http://localhost:3000/api/mcp",
    });
  });

  it("publishes configured cloud OAuth scopes in metadata", async () => {
    const response = protectedResourceMetadataResponse({
      authorizationServerUrl: new URL(
        "https://catwallet-stage.supabase.co/auth/v1",
      ),
      oauthScopes: ["openid"],
      resourceUrl: new URL("https://catwallet-stage.vercel.app/api/mcp"),
    });

    await expect(response.json()).resolves.toMatchObject({
      authorization_servers: ["https://catwallet-stage.supabase.co/auth/v1"],
      resource: "https://catwallet-stage.vercel.app/api/mcp",
      scopes_supported: ["openid"],
    });
  });

  it("fails closed when production host allowlists are not configured", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      createCatWalletMcpHttpHandler({
        environment: {
          NODE_ENV: "production",
          NEXT_PUBLIC_SUPABASE_URL: "https://catwallet-stage.supabase.co",
        } as NodeJS.ProcessEnv,
        resourceUrl: new URL("https://catwallet-stage.vercel.app/api/mcp"),
      }),
    ).toThrow(/CATWALLET_MCP_ALLOWED_HOSTS/);

    expect(errorSpy).toHaveBeenCalledWith(
      "[CatWallet MCP] required runtime environment missing",
      {
        CATWALLET_MCP_ALLOWED_HOSTS: false,
        CATWALLET_MCP_ALLOWED_ORIGINS: false,
        present: false,
        variable: "CATWALLET_MCP_ALLOWED_HOSTS",
      },
    );
    errorSpy.mockRestore();
  });

  it("initializes, lists tools, and calls tools with request-scoped auth", async () => {
    const { handler } = testServer();
    const a = clientFor(handler, "token-a");
    await a.client.connect(a.transport);

    const tools = await a.client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("list_categories");
    expect(tools.tools.map((tool) => tool.name)).toContain(
      "list_payment_accounts",
    );
    const dashboard = await a.client.callTool({
      name: "get_dashboard_summary",
      arguments: {},
    });
    expect(dashboard.structuredContent).toMatchObject({
      data: { month: "2026-09", owner: USER_A },
      ok: true,
    });
    await a.transport.close();
  });

  it("keeps identities isolated between requests", async () => {
    const { handler } = testServer();
    const a = clientFor(handler, "token-a");
    const b = clientFor(handler, "token-b");
    await a.client.connect(a.transport);
    await b.client.connect(b.transport);

    const [aResult, bResult] = await Promise.all([
      a.client.callTool({ name: "list_categories", arguments: {} }),
      b.client.callTool({ name: "list_categories", arguments: {} }),
    ]);
    expect(aResult.structuredContent).toMatchObject({
      data: { items: [{ name: `Food ${USER_A}` }] },
    });
    expect(bResult.structuredContent).toMatchObject({
      data: { items: [{ name: `Food ${USER_B}` }] },
    });
    await a.transport.close();
    await b.transport.close();
  });

  it("uses directory UUIDs in create_transaction without guessing", async () => {
    const { handler, mutations } = testServer();
    const { client, transport } = clientFor(handler, "token-a");
    await client.connect(transport);

    const result = await client.callTool({
      name: "create_transaction",
      arguments: {
        amount: 12,
        categoryId: CATEGORY_ID,
        countsTowardFunMoney: false,
        date: "2026-09-18",
        description: "Lunch",
        idempotencyKey: "http-contract-1",
        paymentAccountId: PAYMENT_ID,
        type: "expense",
      },
    });

    expect(result.structuredContent).toMatchObject({
      data: {
        transaction: {
          category: { id: CATEGORY_ID },
          paymentAccount: { id: PAYMENT_ID },
        },
      },
      ok: true,
    });
    expect(mutations.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        category: CATEGORY_ID,
        paymentMethod: PAYMENT_ID,
      }),
      expect.objectContaining({ userId: USER_A }),
    );
    await transport.close();
  });

  it("returns a discoverable 401 challenge for missing and invalid auth", async () => {
    const { handler } = testServer();
    const body = JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
        protocolVersion: "2025-11-25",
      },
    });
    for (const authorization of [undefined, "Bearer invalid"]) {
      const response = await handler.fetch(
        new Request("http://localhost:3000/api/mcp", {
          body,
          headers: {
            "content-type": "application/json",
            host: "localhost:3000",
            ...(authorization ? { authorization } : {}),
          },
          method: "POST",
        }),
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(
        'resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/api/mcp"',
      );
      expect(await response.text()).not.toContain("Bearer invalid");
    }
  });

  it("publishes both standard and compatibility OAuth security schemes", async () => {
    const { handler } = testServer();
    const response = await handler.fetch(
      new Request("http://localhost:3000/api/mcp", {
        body: JSON.stringify({
          id: 2,
          jsonrpc: "2.0",
          method: "tools/list",
          params: {},
        }),
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer token-a",
          "content-type": "application/json",
          host: "localhost:3000",
        },
        method: "POST",
      }),
    );
    const raw = await response.text();
    const json = response.headers
      .get("content-type")
      ?.includes("text/event-stream")
      ? raw.match(/^data: (.+)$/m)?.[1]
      : raw;
    const body = JSON.parse(json ?? "null") as {
      result: { tools: Array<Record<string, unknown>> };
    };
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.result.tools.length).toBeGreaterThan(0);
    for (const tool of body.result.tools) {
      expect(tool.securitySchemes).toEqual([{ scopes: [], type: "oauth2" }]);
      expect(tool._meta).toMatchObject({
        securitySchemes: [{ scopes: [], type: "oauth2" }],
      });
    }
  });

  it("rejects disallowed origins and invalid or oversized bodies", async () => {
    const { handler } = testServer();
    const spoofedHost = await handler.fetch(
      new Request("http://evil.example/api/mcp", {
        headers: {
          authorization: "Bearer token-a",
          host: "evil.example",
        },
      }),
    );
    expect(spoofedHost.status).toBe(403);

    const forbidden = await handler.fetch(
      new Request("http://localhost:3000/api/mcp", {
        headers: {
          authorization: "Bearer token-a",
          host: "localhost:3000",
          origin: "https://evil.example",
        },
      }),
    );
    expect(forbidden.status).toBe(403);

    const invalid = await handler.fetch(
      new Request("http://localhost:3000/api/mcp", {
        body: "{",
        headers: {
          authorization: "Bearer token-a",
          "content-type": "application/json",
          host: "localhost:3000",
        },
        method: "POST",
      }),
    );
    expect(invalid.status).toBe(400);

    const oversized = await handler.fetch(
      new Request("http://localhost:3000/api/mcp", {
        body: JSON.stringify({ padding: "x".repeat(2000) }),
        headers: {
          authorization: "Bearer token-a",
          "content-type": "application/json",
          host: "localhost:3000",
        },
        method: "POST",
      }),
    );
    expect(oversized.status).toBe(413);
  });

  it("does not expose bearer tokens in HTTP responses", async () => {
    const { handler } = testServer();
    const response = await handler.fetch(
      new Request("http://localhost:3000/api/mcp", {
        headers: {
          authorization: "Bearer token-a",
          host: "localhost:3000",
        },
      }),
    );
    expect(await response.text()).not.toContain("token-a");
  });
});
