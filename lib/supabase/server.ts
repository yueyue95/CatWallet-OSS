import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabaseAuthStorageKey } from "./auth-storage";
import type { Database } from "./database.types";
import { getSupabaseServerUrl } from "./server-url";

type CookieStore = Awaited<ReturnType<typeof cookies>>;

export async function createClient(cookieStore?: CookieStore) {
  const resolvedCookieStore = cookieStore ?? (await cookies());

  return createServerClient<Database>(
    getSupabaseServerUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return resolvedCookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              resolvedCookieStore.set(name, value, options);
            });
          } catch {
            // Server Components cannot write cookies directly.
          }
        },
      },
      auth: {
        storageKey: getSupabaseAuthStorageKey(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
        ),
      },
    },
  );
}
