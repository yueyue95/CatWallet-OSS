import { createCatWalletMcpHttpHandler } from "@/mcp/http";
import { getMcpHttpRuntimeEnvironment } from "@/mcp/runtime-environment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getMcpHandler() {
  return createCatWalletMcpHttpHandler({
    environment: getMcpHttpRuntimeEnvironment(),
  });
}

export async function GET(request: Request) {
  return getMcpHandler().fetch(request);
}

export async function POST(request: Request) {
  return getMcpHandler().fetch(request);
}

export async function DELETE(request: Request) {
  return getMcpHandler().fetch(request);
}
