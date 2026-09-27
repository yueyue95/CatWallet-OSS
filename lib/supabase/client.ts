import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./database.types";
import { getSupabaseAuthStorageKey } from "./auth-storage";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        flowType: "pkce",
        storageKey: getSupabaseAuthStorageKey(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
        ),
        // exchangeCodeForSession roda server-side, sem `window` pra ler
        // sb_flow_id sozinho — sem isso, o cookie verificador PKCE deste
        // flow (`-flow-<id>-code-verifier`) fica órfão a cada login.
        experimental: { appendPkceFlowIdToRedirects: true },
      },
    },
  );
}
