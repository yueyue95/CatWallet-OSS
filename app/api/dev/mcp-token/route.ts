import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const enabled = () =>
  process.env.CATWALLET_ENABLE_DEV_MCP_TOKEN_HELPER === "true";

function tokenForInlineScript(accessToken: string) {
  return JSON.stringify(accessToken).replace(/</g, "\\u003c");
}

function renderCopyPage(accessToken: string) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>CatWallet 本地 MCP 授权</title>
  </head>
  <body>
    <main>
      <h1>CatWallet 本地 MCP 授权</h1>
      <p>此页面只用于当前本地开发验收，不会显示或记录 refresh token。</p>
      <textarea id="token" readonly rows="4" aria-label="短期 access token"></textarea>
      <button id="copy" type="button">复制短期 access token</button>
      <p id="status" role="status"></p>
    </main>
    <script>
      const accessToken = ${tokenForInlineScript(accessToken)};
      const tokenInput = document.getElementById("token");
      const copyButton = document.getElementById("copy");
      const status = document.getElementById("status");
      copyButton.addEventListener("click", async () => {
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(accessToken);
          } else {
            tokenInput.value = accessToken;
            tokenInput.focus();
            tokenInput.select();
            if (!document.execCommand("copy")) throw new Error("copy failed");
          }
          copyButton.disabled = true;
          status.textContent = "已复制。请粘贴到本机被 Git 忽略的 .env.mcp.local，不要发送到聊天。";
        } catch {
          tokenInput.value = accessToken;
          tokenInput.focus();
          tokenInput.select();
          status.textContent = "复制失败，已选中 token；请仅在本机粘贴，不要发送到聊天。";
        }
      });
    </script>
  </body>
</html>`;
}

function response(status: number, body: string) {
  return new NextResponse(body, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
    status,
  });
}

export async function GET() {
  if (!enabled()) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const supabase = await createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return response(401, "Authentication required");
    }

    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (sessionError || !accessToken) {
      return response(401, "Authentication session unavailable");
    }

    return response(200, renderCopyPage(accessToken));
  } catch {
    return response(500, "Development helper unavailable");
  }
}
