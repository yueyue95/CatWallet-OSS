import { afterEach, describe, expect, it } from "vitest";

import { createCatWalletMcpHttpHandler } from "@/mcp/http";
import { getMcpHttpRuntimeEnvironment } from "@/mcp/runtime-environment";

const originalValues = new Map<string, string | undefined>();
const names = [
  "NODE_ENV",
  "CATWALLET_MCP_RESOURCE_URL",
  "CATWALLET_MCP_AUTHORIZATION_SERVER_URL",
  "CATWALLET_MCP_EXPECTED_ISSUER",
  "CATWALLET_MCP_EXPECTED_AUDIENCE",
  "CATWALLET_MCP_ALLOWED_HOSTS",
  "CATWALLET_MCP_ALLOWED_ORIGINS",
  "CATWALLET_MCP_REQUIRED_SCOPES",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
];

afterEach(() => {
  for (const name of names) {
    if (originalValues.has(name)) {
      const value = originalValues.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  originalValues.clear();
});

describe("MCP HTTP runtime environment", () => {
  it("reads deployed configuration at request time without exposing unrelated variables", () => {
    for (const name of names) originalValues.set(name, process.env[name]);
    process.env.CATWALLET_MCP_ALLOWED_HOSTS = "runtime.example.test";
    process.env.CATWALLET_MCP_ALLOWED_ORIGINS = "runtime.example.test";
    process.env.CATWALLET_MCP_REQUIRED_SCOPES = "openid";

    const environment = getMcpHttpRuntimeEnvironment();

    expect(environment.CATWALLET_MCP_ALLOWED_HOSTS).toBe(
      "runtime.example.test",
    );
    expect(environment.CATWALLET_MCP_ALLOWED_ORIGINS).toBe(
      "runtime.example.test",
    );
    expect(environment.CATWALLET_MCP_REQUIRED_SCOPES).toBe("openid");
    expect(environment.UNRELATED_ENVIRONMENT_VALUE).toBeUndefined();
  });

  it("adds only the exact Vercel preview hostnames to both allowlists", () => {
    for (const name of names) originalValues.set(name, process.env[name]);
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_URL = "cat-wallet-preview.vercel.app";
    process.env.VERCEL_BRANCH_URL = "cat-wallet-branch.vercel.app";
    process.env.CATWALLET_MCP_ALLOWED_HOSTS = "cat-wallet-stable.vercel.app";
    process.env.CATWALLET_MCP_ALLOWED_ORIGINS = "cat-wallet-stable.vercel.app";

    const environment = getMcpHttpRuntimeEnvironment();

    expect(environment.CATWALLET_MCP_ALLOWED_HOSTS).toBe(
      "cat-wallet-stable.vercel.app,cat-wallet-preview.vercel.app,cat-wallet-branch.vercel.app",
    );
    expect(environment.CATWALLET_MCP_ALLOWED_ORIGINS).toBe(
      "cat-wallet-stable.vercel.app,cat-wallet-preview.vercel.app,cat-wallet-branch.vercel.app",
    );
  });

  it("derives the preview resource from the exact deployment hostname", () => {
    for (const name of names) originalValues.set(name, process.env[name]);
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_URL = "cat-wallet-preview.vercel.app";
    process.env.CATWALLET_MCP_AUTHORIZATION_SERVER_URL =
      "https://cat-wallet-staging.supabase.co/auth/v1";
    process.env.CATWALLET_MCP_EXPECTED_ISSUER =
      "https://cat-wallet-staging.supabase.co/auth/v1";
    process.env.CATWALLET_MCP_EXPECTED_AUDIENCE = "authenticated";
    process.env.CATWALLET_MCP_REQUIRED_SCOPES = "openid";
    process.env.CATWALLET_MCP_RESOURCE_URL =
      "https://legacy.example.invalid/api/mcp";

    const environment = getMcpHttpRuntimeEnvironment();

    expect(environment.CATWALLET_MCP_RESOURCE_URL).toBe(
      "https://cat-wallet-preview.vercel.app/api/mcp",
    );
    expect(environment.CATWALLET_MCP_AUTHORIZATION_SERVER_URL).toBe(
      "https://cat-wallet-staging.supabase.co/auth/v1",
    );
    expect(environment.CATWALLET_MCP_EXPECTED_ISSUER).toBe(
      "https://cat-wallet-staging.supabase.co/auth/v1",
    );
    expect(environment.CATWALLET_MCP_EXPECTED_AUDIENCE).toBe("authenticated");
    expect(environment.CATWALLET_MCP_REQUIRED_SCOPES).toBe("openid");
  });

  it("keeps preview Host and Origin checks exact", async () => {
    for (const name of names) originalValues.set(name, process.env[name]);
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_URL = "cat-wallet-preview.vercel.app";
    process.env.CATWALLET_MCP_AUTHORIZATION_SERVER_URL =
      "https://cat-wallet-staging.supabase.co/auth/v1";
    process.env.CATWALLET_MCP_ALLOWED_HOSTS =
      "cat-wallet-production.vercel.app";
    process.env.CATWALLET_MCP_ALLOWED_ORIGINS =
      "cat-wallet-production.vercel.app";

    const environment = getMcpHttpRuntimeEnvironment();
    const handler = createCatWalletMcpHttpHandler({ environment });

    const exact = await handler.fetch(
      new Request("https://cat-wallet-preview.vercel.app/api/mcp", {
        headers: {
          host: "cat-wallet-preview.vercel.app",
          origin: "https://cat-wallet-preview.vercel.app",
        },
      }),
    );
    expect(exact.status).toBe(401);
    expect(handler.metadata.resource).toBe(
      "https://cat-wallet-preview.vercel.app/api/mcp",
    );

    const maliciousHost = await handler.fetch(
      new Request("https://evil.example/api/mcp", {
        headers: {
          host: "evil.example",
          origin: "https://cat-wallet-preview.vercel.app",
        },
      }),
    );
    expect(maliciousHost.status).toBe(403);

    const maliciousOrigin = await handler.fetch(
      new Request("https://cat-wallet-preview.vercel.app/api/mcp", {
        headers: {
          host: "cat-wallet-preview.vercel.app",
          origin: "https://evil.example",
        },
      }),
    );
    expect(maliciousOrigin.status).toBe(403);
  });

  it("fails closed when a preview has no exact deployment hostname", () => {
    for (const name of names) originalValues.set(name, process.env[name]);
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_URL = "*.vercel.app";
    process.env.CATWALLET_MCP_RESOURCE_URL =
      "https://legacy.example.invalid/api/mcp";

    expect(() => getMcpHttpRuntimeEnvironment()).toThrow(
      /VERCEL_URL.*preview resource/i,
    );
  });

  it("does not inherit Vercel preview hosts in production", () => {
    for (const name of names) originalValues.set(name, process.env[name]);
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_URL = "cat-wallet-preview.vercel.app";
    process.env.VERCEL_BRANCH_URL = "cat-wallet-branch.vercel.app";
    process.env.CATWALLET_MCP_ALLOWED_HOSTS = "cat-wallet-stable.vercel.app";
    process.env.CATWALLET_MCP_ALLOWED_ORIGINS = "cat-wallet-stable.vercel.app";
    process.env.CATWALLET_MCP_RESOURCE_URL =
      "https://cat-wallet-production.vercel.app/api/mcp";

    const environment = getMcpHttpRuntimeEnvironment();

    expect(environment.CATWALLET_MCP_ALLOWED_HOSTS).toBe(
      "cat-wallet-stable.vercel.app",
    );
    expect(environment.CATWALLET_MCP_ALLOWED_ORIGINS).toBe(
      "cat-wallet-stable.vercel.app",
    );
    expect(environment.CATWALLET_MCP_RESOURCE_URL).toBe(
      "https://cat-wallet-production.vercel.app/api/mcp",
    );
  });

  it("does not add wildcard or path-bearing Vercel values", () => {
    for (const name of names) originalValues.set(name, process.env[name]);
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_URL = "cat-wallet-preview.vercel.app";
    process.env.VERCEL_BRANCH_URL = "preview.vercel.app/path";
    process.env.CATWALLET_MCP_ALLOWED_HOSTS = "cat-wallet-stable.vercel.app";
    process.env.CATWALLET_MCP_ALLOWED_ORIGINS = "cat-wallet-stable.vercel.app";

    const environment = getMcpHttpRuntimeEnvironment();

    expect(environment.CATWALLET_MCP_ALLOWED_HOSTS).toBe(
      "cat-wallet-stable.vercel.app,cat-wallet-preview.vercel.app",
    );
    expect(environment.CATWALLET_MCP_ALLOWED_ORIGINS).toBe(
      "cat-wallet-stable.vercel.app,cat-wallet-preview.vercel.app",
    );
  });
});
