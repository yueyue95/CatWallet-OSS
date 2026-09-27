import { createClient } from "@supabase/supabase-js";
import { expect, test as base } from "@playwright/test";

import { buildSignUpUserMetadata } from "../../lib/auth/email-password";
import { initializeLocale } from "./locale";
import { createTestUser } from "./test-user";

function createLocalAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Local Supabase E2E credentials are required.");
  }

  const parsedUrl = new URL(url);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsedUrl.hostname)) {
    throw new Error("E2E tests refuse non-loopback Supabase targets.");
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function deleteTestUserByEmail(email: string): Promise<void> {
  const admin = createLocalAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1_000,
  });

  if (error) throw error;

  const user = data.users.find((candidate) => candidate.email === email);
  if (!user) return;

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) throw deleteError;
}

export const test = base.extend<{ authenticatedSession: void }>({
  authenticatedSession: [
    async ({ page }, runTest) => {
      const admin = createLocalAdminClient();
      const user = createTestUser();
      const { data, error } = await admin.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
        user_metadata: buildSignUpUserMetadata(user.firstName, user.lastName),
      });

      if (error || !data.user) {
        throw error ?? new Error("Failed to create the isolated E2E user.");
      }

      try {
        await initializeLocale(page, "en");
        await page.goto("/");
        await page.getByLabel("Email", { exact: true }).fill(user.email);
        await page.locator("#auth-password").fill(user.password);
        await page.getByRole("button", { name: "Sign in with email" }).click();
        await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

        await runTest();
      } finally {
        await page.close();
        const { error: deleteError } = await admin.auth.admin.deleteUser(
          data.user.id,
        );
        if (deleteError) throw deleteError;
      }
    },
    { auto: true },
  ],
});

export { expect };
