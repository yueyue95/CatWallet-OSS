import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";

import { getSafeRedirectPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

function redactAuthErrorMessage(message: string | undefined): string {
  return String(message ?? "unknown").replace(
    /((?:^|[\s?&])(?:auth_)?(?:code|token|token_hash|access_token|refresh_token|password|verifier|sb_flow_id)=)[^\s&]*/gi,
    "$1[redacted]",
  );
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const cookieStore = await cookies();
  const requestCookies = cookieStore.getAll();
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next");
  const flowId = requestUrl.searchParams.get("sb_flow_id");
  const redirectPath = getSafeRedirectPath(next, requestUrl.origin);
  const hasFlowVerifierCookie = flowId
    ? requestCookies.some(({ name }) =>
        name.endsWith(`-flow-${flowId}-code-verifier`),
      )
    : false;

  if (flowId && !/^[A-Za-z0-9_-]{8,64}$/.test(flowId)) {
    return NextResponse.redirect(
      new URL("/?auth_error=callback_exchange_failed", requestUrl.origin),
    );
  }

  if (code && next === "/auth/update-password" && !flowId) {
    return NextResponse.redirect(
      new URL("/?auth_error=callback_exchange_failed", requestUrl.origin),
    );
  }

  if (!code) {
    return NextResponse.redirect(new URL("/dashboard", requestUrl.origin));
  }

  const supabase = await createClient(cookieStore);
  // Passing the flow id lets auth-js select and clear the matching PKCE
  // verifier cookie when multiple auth flows exist in the same browser.
  const { data, error } = await supabase.auth.exchangeCodeForSession(
    code,
    flowId ? { flowId } : undefined,
  );

  if (error || !data.session) {
    console.error("[auth/callback] exchangeCodeForSession failed", {
      errorCode: error?.code ?? "missing_session",
      errorMessage: redactAuthErrorMessage(error?.message),
      hasCode: Boolean(code),
      hasFlowId: Boolean(flowId),
      hasFlowVerifierCookie,
    });

    return NextResponse.redirect(
      new URL("/?auth_error=callback_exchange_failed", requestUrl.origin),
    );
  }

  return NextResponse.redirect(new URL(redirectPath, requestUrl.origin));
}
