import {
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  hostHeaderValidationResponse,
  isJsonContentType,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  OAuthError,
  originValidationResponse,
  requireBearerAuth,
  type AuthInfo,
  type OAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/server";

import {
  authenticateMcpAccessToken,
  createStaticMcpAuthProvider,
  type RequestScopedMcpAuth,
} from "@/mcp/auth/context";
import { createMcpServer, type McpServerOptions } from "@/mcp/server";
import { resolveMcpTimeZone } from "@/mcp/timezone";
import type { AuthenticatedUserContext } from "@/lib/finance/transactions";

const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;

type HttpAuthResult = RequestScopedMcpAuth;

export type McpHttpOptions = {
  allowedHosts?: string[];
  allowedOriginHostnames?: string[];
  authenticate?: (accessToken: string) => Promise<HttpAuthResult>;
  authorizationServerUrl?: URL;
  bodyLimitBytes?: number;
  environment?: NodeJS.ProcessEnv;
  mcpServerOptions?: Omit<McpServerOptions, "auth" | "timeZone">;
  oauthScopes?: string[];
  resourceUrl?: URL;
  timeZone?: string;
};

function environmentUrl(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
) {
  if (environment.NODE_ENV === "production" && !environment[name]?.trim()) {
    throw new Error(`${name} is required in production.`);
  }
  const value = environment[name]?.trim() || fallback;
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }
}

function authorizationServerUrl(environment: NodeJS.ProcessEnv) {
  const explicit = environment.CATWALLET_MCP_AUTHORIZATION_SERVER_URL?.trim();
  if (explicit) {
    try {
      return new URL(explicit);
    } catch {
      throw new Error(
        "CATWALLET_MCP_AUTHORIZATION_SERVER_URL must be an absolute URL.",
      );
    }
  }
  const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is required for MCP metadata.");
  }
  return new URL("auth/v1", `${supabaseUrl.replace(/\/$/, "")}/`);
}

function listEnvironmentValue(value: string | undefined, fallback: string[]) {
  const values = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return values?.length ? values : fallback;
}

function requiredProductionEnvironmentList(
  environment: NodeJS.ProcessEnv,
  name: "CATWALLET_MCP_ALLOWED_HOSTS" | "CATWALLET_MCP_ALLOWED_ORIGINS",
  fallback: string[],
) {
  const configured = listEnvironmentValue(environment[name], []);
  if (configured.length > 0) return configured;
  if (environment.NODE_ENV === "production") {
    console.error("[CatWallet MCP] required runtime environment missing", {
      CATWALLET_MCP_ALLOWED_HOSTS: Boolean(
        environment.CATWALLET_MCP_ALLOWED_HOSTS?.trim(),
      ),
      CATWALLET_MCP_ALLOWED_ORIGINS: Boolean(
        environment.CATWALLET_MCP_ALLOWED_ORIGINS?.trim(),
      ),
      present: false,
      variable: name,
    });
    throw new Error(`${name} is required in production.`);
  }
  return fallback;
}

function createProtectedResourceMetadata(options: McpHttpOptions = {}) {
  const environment = options.environment ?? process.env;
  const resourceUrl =
    options.resourceUrl ??
    environmentUrl(
      environment,
      "CATWALLET_MCP_RESOURCE_URL",
      "http://localhost:3000/api/mcp",
    );
  const issuer =
    options.authorizationServerUrl ?? authorizationServerUrl(environment);
  const oauthScopes =
    options.oauthScopes ??
    listEnvironmentValue(environment.CATWALLET_MCP_REQUIRED_SCOPES, []);

  return {
    metadata: {
      authorization_servers: [issuer.toString().replace(/\/$/, "")],
      bearer_methods_supported: ["header"],
      resource: resourceUrl.toString(),
      ...(oauthScopes.length > 0 ? { scopes_supported: oauthScopes } : {}),
    } satisfies OAuthProtectedResourceMetadata,
    metadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrl),
    resourceUrl,
    oauthScopes,
  };
}

async function parseBodyWithLimit(request: Request, limit: number) {
  if (request.method !== "POST") return undefined;
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return new Response("Content-Type must be application/json.", {
      status: 415,
    });
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    return new Response("Request body is too large.", { status: 413 });
  }
  if (!request.body) {
    return new Response("Request body must contain JSON.", { status: 400 });
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return new Response("Request body is too large.", { status: 413 });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return new Response("Request body must contain valid JSON.", {
      status: 400,
    });
  }
}

function contextFromAuthInfo(authInfo: AuthInfo | undefined) {
  const context = authInfo?.extra?.context;
  if (!context || typeof context !== "object" || !("userId" in context)) {
    throw new Error("Authenticated MCP context is missing.");
  }
  return context as AuthenticatedUserContext;
}

function withTopLevelSecuritySchemes(body: unknown): unknown {
  if (
    body &&
    typeof body === "object" &&
    "result" in body &&
    body.result &&
    typeof body.result === "object" &&
    "tools" in body.result &&
    Array.isArray(body.result.tools)
  ) {
    body.result.tools = body.result.tools.map((tool) => {
      if (!tool || typeof tool !== "object") return tool;
      const metadata = "_meta" in tool ? tool._meta : undefined;
      const securitySchemes =
        metadata &&
        typeof metadata === "object" &&
        "securitySchemes" in metadata
          ? metadata.securitySchemes
          : undefined;
      return securitySchemes ? { ...tool, securitySchemes } : tool;
    });
  }
  return body;
}

async function projectOpenAiToolSecuritySchemes(response: Response) {
  if (response.status !== 200) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const text = await response.text();
    if (!text) return new Response(null, response);
    try {
      return new Response(
        JSON.stringify(withTopLevelSecuritySchemes(JSON.parse(text))),
        response,
      );
    } catch {
      return new Response(text, response);
    }
  }
  if (contentType.includes("text/event-stream")) {
    const text = await response.text();
    const projected = text.replace(/^data: (.+)$/gm, (line, json: string) => {
      try {
        return `data: ${JSON.stringify(withTopLevelSecuritySchemes(JSON.parse(json)))}`;
      } catch {
        return line;
      }
    });
    return new Response(projected, response);
  }
  return response;
}

export function createCatWalletMcpHttpHandler(options: McpHttpOptions = {}) {
  const environment = options.environment ?? process.env;
  const {
    metadata,
    metadataUrl: resourceMetadataUrl,
    oauthScopes,
  } = createProtectedResourceMetadata(options);
  const authenticate =
    options.authenticate ??
    ((accessToken: string) =>
      authenticateMcpAccessToken(accessToken, environment));
  const timeZone = options.timeZone ?? resolveMcpTimeZone(environment);
  const allowedHosts =
    options.allowedHosts ??
    requiredProductionEnvironmentList(
      environment,
      "CATWALLET_MCP_ALLOWED_HOSTS",
      localhostAllowedHostnames(),
    );
  const allowedOriginHostnames =
    options.allowedOriginHostnames ??
    requiredProductionEnvironmentList(
      environment,
      "CATWALLET_MCP_ALLOWED_ORIGINS",
      localhostAllowedOrigins(),
    );
  const configuredBodyLimit = Number(
    environment.CATWALLET_MCP_BODY_LIMIT_BYTES,
  );
  const bodyLimitBytes =
    options.bodyLimitBytes ??
    (Number.isSafeInteger(configuredBodyLimit) && configuredBodyLimit > 0
      ? configuredBodyLimit
      : DEFAULT_BODY_LIMIT_BYTES);

  const authGate = requireBearerAuth({
    resourceMetadataUrl,
    verifier: {
      async verifyAccessToken(accessToken) {
        let auth: HttpAuthResult;
        try {
          auth = await authenticate(accessToken);
        } catch {
          throw new OAuthError(
            "invalid_token",
            "CatWallet MCP authentication failed.",
          );
        }
        return {
          clientId: auth.clientId ?? "catwallet",
          expiresAt: auth.expiresAt,
          extra: { context: auth.context },
          scopes: auth.scopes ?? [],
          token: accessToken,
        };
      },
    },
    requiredScopes: oauthScopes,
  });

  const handler = createMcpHandler(
    ({ authInfo }) =>
      createMcpServer({
        ...options.mcpServerOptions,
        auth: createStaticMcpAuthProvider(contextFromAuthInfo(authInfo)),
        oauthScopes,
        timeZone,
      }),
    { legacy: "stateless", responseMode: "json" },
  );

  return {
    async fetch(request: Request) {
      const rejected =
        hostHeaderValidationResponse(request, allowedHosts) ??
        originValidationResponse(request, allowedOriginHostnames);
      if (rejected) return rejected;

      const auth = await authGate(request);
      if (auth instanceof Response) return auth;

      const parsedBody = await parseBodyWithLimit(request, bodyLimitBytes);
      if (parsedBody instanceof Response) return parsedBody;
      const response = await handler.fetch(request, {
        authInfo: auth,
        parsedBody,
      });
      return parsedBody &&
        typeof parsedBody === "object" &&
        "method" in parsedBody &&
        parsedBody.method === "tools/list"
        ? projectOpenAiToolSecuritySchemes(response)
        : response;
    },
    metadata,
    metadataUrl: resourceMetadataUrl,
  };
}

export function protectedResourceMetadataResponse(
  options: McpHttpOptions = {},
) {
  const { metadata } = createProtectedResourceMetadata(options);
  return Response.json(metadata, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
    },
  });
}
