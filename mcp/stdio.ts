import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createLocalMcpAuthProvider } from "@/mcp/auth/context";
import { createMcpServer } from "@/mcp/server";

const handle = serveStdio(
  () =>
    createMcpServer({
      auth: createLocalMcpAuthProvider(),
    }),
  { onerror: () => console.error("[CatWallet MCP] transport error") },
);

console.error("CatWallet MCP server running on stdio");

process.once("SIGINT", () => {
  void handle.close().finally(() => process.exit(0));
});

process.once("SIGTERM", () => {
  void handle.close().finally(() => process.exit(0));
});
