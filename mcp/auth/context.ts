import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { AuthenticatedUserContext } from "@/lib/finance/transactions";
import type { Database } from "@/lib/supabase/database.types";

import { McpToolError } from "@/mcp/response";

export interface McpAuthContextProvider {
  getContext(): Promise<AuthenticatedUserContext>;
}

export type RequestScopedMcpAuth = {
  context: AuthenticatedUserContext;
  expiresAt: number;
  clientId?: string;
  scopes: string[];
};

function requiredEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new McpToolError(
      "UNAUTHENTICATED",
      "CatWallet MCP authentication is not configured.",
    );
  }
  return value;
}

function contextFromUser(
  supabase: SupabaseClient,
  user: AuthenticatedUserContext["user"],
): AuthenticatedUserContext {
  return {
    claims: {
      email: user.email ?? undefined,
      sub: user.id,
    },
    createdAt: user.created_at ?? null,
    supabase,
    user,
    userId: user.id,
  };
}

function claimValues(value: unknown): string[] {
  if (typeof value === "string") return value.split(/[ ,]+/).filter(Boolean);
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function configuredValues(environment: NodeJS.ProcessEnv, name: string) {
  return claimValues(environment[name]?.trim());
}

function validateIssuerAndAudience(
  claims: Record<string, unknown>,
  environment: NodeJS.ProcessEnv,
) {
  const expectedIssuer = environment.CATWALLET_MCP_EXPECTED_ISSUER?.trim();
  const expectedAudience =
    environment.CATWALLET_MCP_EXPECTED_AUDIENCE?.trim() || "authenticated";

  if (environment.NODE_ENV === "production" && !expectedIssuer) {
    throw new McpToolError(
      "UNAUTHENTICATED",
      "CatWallet MCP issuer validation is not configured.",
    );
  }

  if (expectedIssuer && claims.iss !== expectedIssuer) {
    throw new McpToolError(
      "UNAUTHENTICATED",
      "CatWallet MCP authentication failed.",
    );
  }

  if (!claimValues(claims.aud).includes(expectedAudience)) {
    throw new McpToolError(
      "UNAUTHENTICATED",
      "CatWallet MCP authentication failed.",
    );
  }
}

export async function authenticateMcpAccessToken(
  accessToken: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<RequestScopedMcpAuth> {
  if (!accessToken.trim()) {
    throw new McpToolError(
      "UNAUTHENTICATED",
      "CatWallet MCP authentication failed.",
    );
  }
  const url = requiredEnvironmentValue(environment, "NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = requiredEnvironmentValue(
    environment,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );
  const supabase = createClient<Database>(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data, error } = await supabase.auth.getClaims(accessToken);
  const claims = data?.claims;
  const subject = claims?.sub;
  if (error || !claims || typeof subject !== "string" || subject.length === 0) {
    throw new McpToolError(
      "UNAUTHENTICATED",
      "CatWallet MCP authentication failed.",
    );
  }
  validateIssuerAndAudience(claims, environment);
  const expiresAt = claims.exp;
  if (typeof expiresAt !== "number" || expiresAt <= Date.now() / 1000) {
    throw new McpToolError(
      "UNAUTHENTICATED",
      "CatWallet MCP authentication failed.",
    );
  }
  const { data: userData, error: userError } =
    await supabase.auth.getUser(accessToken);
  if (userError || !userData.user || userData.user.id !== subject) {
    throw new McpToolError(
      "UNAUTHENTICATED",
      "CatWallet MCP authentication failed.",
    );
  }
  const scopes = claimValues(claims.scope);
  const requiredScopes = configuredValues(
    environment,
    "CATWALLET_MCP_REQUIRED_SCOPES",
  );
  if (requiredScopes.some((scope) => !scopes.includes(scope))) {
    throw new McpToolError(
      "UNAUTHENTICATED",
      "CatWallet MCP authentication failed.",
    );
  }
  return {
    clientId:
      typeof claims.client_id === "string" ? claims.client_id : undefined,
    context: contextFromUser(supabase, userData.user),
    expiresAt,
    scopes,
  };
}

export function createLocalMcpAuthProvider(
  environment: NodeJS.ProcessEnv = process.env,
): McpAuthContextProvider {
  return {
    async getContext() {
      const accessToken = requiredEnvironmentValue(
        environment,
        "CATWALLET_MCP_ACCESS_TOKEN",
      );
      return (await authenticateMcpAccessToken(accessToken, environment))
        .context;
    },
  };
}

export function createStaticMcpAuthProvider(
  context: AuthenticatedUserContext,
): McpAuthContextProvider {
  return {
    async getContext() {
      return context;
    },
  };
}
