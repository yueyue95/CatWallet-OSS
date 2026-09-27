import { protectedResourceMetadataResponse } from "@/mcp/http";
import { getMcpHttpRuntimeEnvironment } from "@/mcp/runtime-environment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return protectedResourceMetadataResponse({
    environment: getMcpHttpRuntimeEnvironment(),
  });
}
