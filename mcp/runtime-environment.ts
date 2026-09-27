const MCP_HTTP_ENVIRONMENT_NAMES = [
  "NODE_ENV",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "CATWALLET_MCP_RESOURCE_URL",
  "CATWALLET_MCP_AUTHORIZATION_SERVER_URL",
  "CATWALLET_MCP_EXPECTED_ISSUER",
  "CATWALLET_MCP_EXPECTED_AUDIENCE",
  "CATWALLET_MCP_REQUIRED_SCOPES",
  "CATWALLET_MCP_ALLOWED_HOSTS",
  "CATWALLET_MCP_ALLOWED_ORIGINS",
  "CATWALLET_MCP_BODY_LIMIT_BYTES",
  "CATWALLET_MCP_TIME_ZONE",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
] as const;

function exactVercelHostname(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.includes("*")) return undefined;

  try {
    const url = new URL(
      trimmed.includes("://") ? trimmed : `https://${trimmed}`,
    );
    const invalidUrlParts = [
      url.protocol !== "https:",
      Boolean(url.username),
      Boolean(url.password),
      url.pathname !== "/",
      Boolean(url.search),
      Boolean(url.hash),
      !url.hostname,
    ];
    if (invalidUrlParts.some(Boolean)) {
      return undefined;
    }
    return url.host;
  } catch {
    return undefined;
  }
}

function withPreviewHostnames(
  configured: string | undefined,
  environment: NodeJS.ProcessEnv,
) {
  const values =
    configured
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  if (environment.VERCEL_ENV !== "preview") return values.join(",");

  for (const value of [environment.VERCEL_URL, environment.VERCEL_BRANCH_URL]) {
    const hostname = exactVercelHostname(value);
    if (hostname && !values.includes(hostname)) values.push(hostname);
  }
  return values.join(",");
}

function previewResourceUrl(environment: NodeJS.ProcessEnv) {
  if (environment.VERCEL_ENV !== "preview") return undefined;
  const hostname = exactVercelHostname(environment.VERCEL_URL);
  if (!hostname) {
    throw new Error(
      "VERCEL_URL must be an exact HTTPS hostname for the preview resource.",
    );
  }
  return `https://${hostname}/api/mcp`;
}

/**
 * Read HTTP MCP configuration from the Node.js request environment.
 *
 * The computed lookup is intentional: these values belong to the deployed
 * function environment and must not be captured as build-time constants by
 * Next.js. The allowlist is also kept narrow so unrelated process variables
 * are never passed into request authentication.
 */
export function getMcpHttpRuntimeEnvironment(): NodeJS.ProcessEnv {
  const runtimeEnvironment = process.env;
  const environment = Object.fromEntries(
    MCP_HTTP_ENVIRONMENT_NAMES.map((name) => [name, runtimeEnvironment[name]]),
  ) as NodeJS.ProcessEnv;

  environment.CATWALLET_MCP_ALLOWED_HOSTS = withPreviewHostnames(
    runtimeEnvironment.CATWALLET_MCP_ALLOWED_HOSTS,
    runtimeEnvironment,
  );
  environment.CATWALLET_MCP_ALLOWED_ORIGINS = withPreviewHostnames(
    runtimeEnvironment.CATWALLET_MCP_ALLOWED_ORIGINS,
    runtimeEnvironment,
  );
  const resourceUrl = previewResourceUrl(runtimeEnvironment);
  if (resourceUrl) environment.CATWALLET_MCP_RESOURCE_URL = resourceUrl;
  return environment;
}
