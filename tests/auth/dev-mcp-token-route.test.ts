import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, getSession, getUser } = vi.hoisted(() => ({
  createClient: vi.fn(),
  getSession: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient }));

import { GET } from "@/app/api/dev/mcp-token/route";

describe("GET /api/dev/mcp-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CATWALLET_ENABLE_DEV_MCP_TOKEN_HELPER = "true";
    getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    getSession.mockResolvedValue({
      data: {
        session: {
          access_token: "fixture-access-token",
          refresh_token: "fixture-refresh-token",
        },
      },
      error: null,
    });
    createClient.mockResolvedValue({
      auth: { getSession, getUser },
    });
  });

  afterEach(() => {
    delete process.env.CATWALLET_ENABLE_DEV_MCP_TOKEN_HELPER;
  });

  it("reads the current SSR session and exposes only a copy action for access_token", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/dev/mcp-token"),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(getUser).toHaveBeenCalledOnce();
    expect(getSession).toHaveBeenCalledOnce();
    expect(body).toContain('id="token"');
    expect(body).toContain("fixture-access-token");
    expect(body).toContain("navigator.clipboard.writeText");
    expect(body).not.toContain("fixture-refresh-token");
  });

  it("fails closed unless the development helper is explicitly enabled", async () => {
    delete process.env.CATWALLET_ENABLE_DEV_MCP_TOKEN_HELPER;

    const response = await GET(
      new NextRequest("http://localhost/api/dev/mcp-token"),
    );

    expect(response.status).toBe(404);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("does not expose a token when the current request is unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET(
      new NextRequest("http://localhost/api/dev/mcp-token"),
    );

    expect(response.status).toBe(401);
    expect(getSession).not.toHaveBeenCalled();
  });
});
