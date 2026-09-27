import { describe, expect, it } from "vitest";

import { createLocalMcpAuthProvider } from "@/mcp/auth/context";

describe("CatWallet MCP local authentication", () => {
  it("fails closed when the local auth configuration is incomplete", async () => {
    const provider = createLocalMcpAuthProvider({});

    await expect(provider.getContext()).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
});
