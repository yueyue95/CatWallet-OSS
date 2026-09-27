import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { exchangeCodeForSession, createClient, cookies } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn().mockResolvedValue({
    data: { session: { user: { id: "user-1" } } },
    error: null,
  }),
  createClient: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("next/headers", () => ({ cookies }));

import { GET } from "@/app/auth/callback/route";

describe("GET /auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookies.mockResolvedValue({
      getAll: vi.fn().mockReturnValue([]),
      set: vi.fn(),
    });
    exchangeCodeForSession.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    });
    createClient.mockResolvedValue({
      auth: { exchangeCodeForSession },
    });
  });

  it("exchanges the code for a session and redirects to the safe 'next' path", async () => {
    const request = new NextRequest(
      "http://localhost/auth/callback?code=abc123&next=/transactions",
    );

    const response = await GET(request);

    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123", undefined);
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({ getAll: expect.any(Function) }),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/transactions",
    );
  });

  it("passes sb_flow_id through so the matching PKCE verifier cookie is cleaned up", async () => {
    const request = new NextRequest(
      "http://localhost/auth/callback?code=abc123&sb_flow_id=flow-xyz",
    );

    await GET(request);

    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123", {
      flowId: "flow-xyz",
    });
  });

  it("rejects a password recovery callback without its flow id", async () => {
    const request = new NextRequest(
      "http://localhost/auth/callback?code=abc123&next=/auth/update-password",
    );

    const response = await GET(request);

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "http://localhost/?auth_error=callback_exchange_failed",
    );
  });

  it("rejects malformed flow ids before attempting an exchange", async () => {
    const request = new NextRequest(
      "http://localhost/auth/callback?code=abc123&sb_flow_id=short",
    );

    const response = await GET(request);

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "http://localhost/?auth_error=callback_exchange_failed",
    );
  });

  it("keeps parallel flow ids separate when forwarding callbacks", async () => {
    await GET(
      new NextRequest(
        "http://localhost/auth/callback?code=code-a&sb_flow_id=flow-aaa",
      ),
    );
    await GET(
      new NextRequest(
        "http://localhost/auth/callback?code=code-b&sb_flow_id=flow-bbb",
      ),
    );

    expect(exchangeCodeForSession).toHaveBeenNthCalledWith(1, "code-a", {
      flowId: "flow-aaa",
    });
    expect(exchangeCodeForSession).toHaveBeenNthCalledWith(2, "code-b", {
      flowId: "flow-bbb",
    });
  });

  it("does not process provider tokens after a successful exchange", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: {
        session: {
          access_token: "at-123",
          refresh_token: "rt-456",
          provider_token: "google-at",
        },
      },
      error: null,
    });
    const request = new NextRequest(
      "http://localhost/auth/callback?code=abc123",
    );

    await GET(request);

    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123", undefined);
  });

  it("skips the exchange and redirects to /dashboard when there is no code or 'next' param", async () => {
    const request = new NextRequest("http://localhost/auth/callback");

    const response = await GET(request);

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("http://localhost/dashboard");
  });

  it("does not enter password update without a successful code exchange", async () => {
    const request = new NextRequest(
      "http://localhost/auth/callback?next=/auth/update-password",
    );

    const response = await GET(request);

    expect(response.headers.get("location")).toBe("http://localhost/dashboard");
  });

  it("logs only sanitized exchange errors and redirects to a safe failure path", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: {
        code: "invalid_grant",
        message:
          "auth_code=sensitive-oauth-code&sb_flow_id=sensitive-flow-id&password=sensitive-password&verifier=sensitive-verifier",
      },
    });
    const request = new NextRequest(
      "http://localhost/auth/callback?code=sensitive-oauth-code&next=/auth/update-password&sb_flow_id=flow-xyz",
    );

    const response = await GET(request);

    expect(response.headers.get("location")).toBe(
      "http://localhost/?auth_error=callback_exchange_failed",
    );
    expect(errorLog).toHaveBeenCalledWith(
      "[auth/callback] exchangeCodeForSession failed",
      expect.objectContaining({
        errorCode: "invalid_grant",
        hasCode: true,
        hasFlowId: true,
      }),
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      "sensitive-oauth-code",
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      "sensitive-flow-id",
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      "sensitive-password",
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      "sensitive-verifier",
    );
    expect(response.headers.get("location")).not.toContain(
      "sensitive-verifier",
    );
    errorLog.mockRestore();
  });

  it("falls back to /dashboard when 'next' points off-site", async () => {
    const request = new NextRequest(
      "http://localhost/auth/callback?code=abc123&next=//evil.com",
    );

    const response = await GET(request);

    expect(response.headers.get("location")).toBe("http://localhost/dashboard");
  });
});
