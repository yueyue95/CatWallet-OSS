// @vitest-environment node

import { randomUUID } from "node:crypto";

import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { getPasswordResetRedirectUrl } from "@/lib/auth/redirect";
import { getSupabaseAuthStorageKey } from "@/lib/supabase/auth-storage";
import type { Database } from "@/lib/supabase/database.types";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const publishableKey = requiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
// eslint-disable-next-line sonarjs/no-clear-text-protocols -- local PKCE test app origin intentionally uses HTTP
const appUrl = process.env.CATWALLET_APP_URL ?? "http://127.0.0.1:3000";
const inbucketUrl = process.env.INBUCKET_URL ?? "http://127.0.0.1:56434";

const supabaseVerifyOrigins = new Set([new URL(supabaseUrl).origin]);
const publicSupabaseUrl = process.env.CATWALLET_PUBLIC_SUPABASE_URL;
if (publicSupabaseUrl) {
  supabaseVerifyOrigins.add(new URL(publicSupabaseUrl).origin);
} else {
  const appOrigin = new URL(appUrl);
  const apiOrigin = new URL(supabaseUrl);
  supabaseVerifyOrigins.add(
    `${apiOrigin.protocol}//${appOrigin.hostname}:${apiOrigin.port}`,
  );
}

type CookieJar = {
  values: Map<string, string>;
  cookies: {
    getAll: () => Array<{ name: string; value: string }>;
    setAll: (
      cookiesToSet: Array<{
        name: string;
        value: string;
        options?: { maxAge?: number };
      }>,
    ) => void;
  };
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing integration test environment variable: ${name}`);
  }
  return value;
}

function createCookieJar(): CookieJar {
  const values = new Map<string, string>();

  return {
    values,
    cookies: {
      getAll: () => [...values].map(([name, value]) => ({ name, value })),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) => {
          if (options?.maxAge === 0 || value === "") {
            values.delete(name);
          } else {
            values.set(name, value);
          }
        });
      },
    },
  };
}

function cookieHeader(jar: CookieJar): string {
  return [...jar.values].map(([name, value]) => `${name}=${value}`).join("; ");
}

function applyResponseCookies(response: Response, jar: CookieJar): void {
  response.headers.getSetCookie().forEach((setCookie) => {
    const separatorIndex = setCookie.indexOf(";");
    const pair =
      separatorIndex === -1 ? setCookie : setCookie.slice(0, separatorIndex);
    const equalsIndex = pair.indexOf("=");
    if (equalsIndex === -1) return;

    const name = pair.slice(0, equalsIndex);
    const value = pair.slice(equalsIndex + 1);
    if (value === "") {
      jar.values.delete(name);
    } else {
      jar.values.set(name, value);
    }
  });
}

function createBrowserSupabase(jar: CookieJar) {
  return createBrowserClient<Database>(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      flowType: "pkce",
      persistSession: true,
      experimental: { appendPkceFlowIdToRedirects: true },
      storageKey: getSupabaseAuthStorageKey(supabaseUrl),
    },
    cookies: jar.cookies,
  });
}

async function waitForResetMessage(email: string): Promise<{
  HTML?: string;
  Text?: string;
}> {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    const listResponse = await fetch(`${inbucketUrl}/api/v1/messages`);
    if (listResponse.ok) {
      const list = (await listResponse.json()) as {
        messages?: Array<{ ID?: string; To?: string; Created?: string }>;
      };
      const message = list.messages?.find((candidate) => {
        if (!candidate.ID) return false;
        return JSON.stringify(candidate).includes(email);
      });

      if (message?.ID) {
        const detailResponse = await fetch(
          `${inbucketUrl}/api/v1/message/${encodeURIComponent(message.ID)}`,
        );
        if (detailResponse.ok) {
          return (await detailResponse.json()) as {
            HTML?: string;
            Text?: string;
          };
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("reset email was not delivered to local Inbucket");
}

function findVerifyUrl(message: { HTML?: string; Text?: string }): URL {
  const contents = [message.HTML, message.Text].filter(
    (content): content is string => Boolean(content),
  );
  const candidates = contents.flatMap(
    (content) => content.match(/https?:\/\/[^\s"'<>]+/g) ?? [],
  );

  for (const candidate of candidates) {
    try {
      const url = new URL(
        candidate.replaceAll("&amp;", "&").replaceAll("&quot;", '"'),
      );
      if (url.pathname === "/auth/v1/verify") return url;
    } catch {
      // Ignore non-URL fragments in the email body.
    }
  }

  throw new Error("reset email did not contain the local Auth verify URL");
}

async function requestResetCallback(
  email: string,
  browser: ReturnType<typeof createBrowserSupabase>,
  jar: CookieJar,
): Promise<URL> {
  const reset = await browser.auth.resetPasswordForEmail(email, {
    redirectTo: getPasswordResetRedirectUrl(appUrl),
  });
  if (reset.error) {
    throw new Error(`reset request failed (${reset.error.code ?? "unknown"})`);
  }

  const message = await waitForResetMessage(email);
  const verifyUrl = findVerifyUrl(message);
  expect(supabaseVerifyOrigins.has(verifyUrl.origin)).toBe(true);

  const verifyResponse = await fetch(verifyUrl, { redirect: "manual" });
  expect(verifyResponse.status).toBeGreaterThanOrEqual(300);
  expect(verifyResponse.status).toBeLessThan(400);

  const callbackLocation = verifyResponse.headers.get("location");
  expect(callbackLocation).toBeTruthy();
  if (!callbackLocation) {
    throw new Error("Auth verify had no callback location");
  }

  const callbackUrl = new URL(callbackLocation);
  expect(callbackUrl.origin).toBe(new URL(appUrl).origin);
  expect(callbackUrl.pathname).toBe("/auth/callback");
  expect(callbackUrl.searchParams.has("code")).toBe(true);
  expect(callbackUrl.searchParams.has("sb_flow_id")).toBe(true);
  const flowId = callbackUrl.searchParams.get("sb_flow_id");
  expect(flowId).toBeTruthy();
  if (
    !flowId ||
    ![...jar.values.keys()].some((name) =>
      name.endsWith(`-flow-${flowId}-code-verifier`),
    )
  ) {
    throw new Error("PKCE verifier cookie did not match callback flow");
  }

  return callbackUrl;
}

describe("local Supabase password reset PKCE flow", () => {
  it("resets, verifies, exchanges with sb_flow_id, updates, and signs in", async () => {
    const email = `catwallet-pkce-${randomUUID()}@example.test`;
    const initialPassword = `CatWallet-${randomUUID()}-Aa1!`;
    const replacementPassword = `CatWallet-${randomUUID()}-Bb2!`;
    const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const jar = createCookieJar();

    let userId: string | undefined;

    try {
      const created = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        password: initialPassword,
      });
      if (created.error || !created.data.user) {
        throw new Error(
          `could not create reset test user (${created.error?.code ?? "unknown"})`,
        );
      }
      userId = created.data.user.id;

      const browser = createBrowserSupabase(jar);
      const callbackUrl = await requestResetCallback(email, browser, jar);

      const callbackResponse = await fetch(callbackUrl, {
        headers: { cookie: cookieHeader(jar) },
        redirect: "manual",
      });
      applyResponseCookies(callbackResponse, jar);
      expect(callbackResponse.status).toBeGreaterThanOrEqual(300);
      expect(callbackResponse.status).toBeLessThan(400);
      expect(
        new URL(callbackResponse.headers.get("location") ?? "").pathname,
      ).toBe("/auth/update-password");

      const updatePage = await fetch(new URL("/auth/update-password", appUrl), {
        headers: { cookie: cookieHeader(jar) },
      });
      expect(updatePage.status).toBe(200);

      const authenticatedBrowser = createBrowserSupabase(jar);
      const claims = await authenticatedBrowser.auth.getClaims();
      if (claims.error || !claims.data?.claims) {
        throw new Error(
          `callback did not create a session (${claims.error?.code ?? "unknown"})`,
        );
      }
      expect(claims.data.claims.sub).toBe(userId);

      const update = await authenticatedBrowser.auth.updateUser({
        password: replacementPassword,
      });
      if (update.error) {
        throw new Error(
          `password update failed (${update.error.code ?? "unknown"})`,
        );
      }

      const login = createClient<Database>(supabaseUrl, publishableKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const signedIn = await login.auth.signInWithPassword({
        email,
        password: replacementPassword,
      });
      if (signedIn.error || !signedIn.data.user) {
        throw new Error(
          `new password login failed (${signedIn.error?.code ?? "unknown"})`,
        );
      }
      expect(signedIn.data.user.id).toBe(userId);
    } finally {
      if (userId) {
        await admin.auth.admin.deleteUser(userId);
      }
    }
  });

  it("does not cross-use verifiers between parallel reset flows", async () => {
    const users = [
      {
        email: `catwallet-pkce-a-${randomUUID()}@example.test`,
        password: `CatWallet-${randomUUID()}-Aa1!`,
      },
      {
        email: `catwallet-pkce-b-${randomUUID()}@example.test`,
        password: `CatWallet-${randomUUID()}-Bb2!`,
      },
    ];
    const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const jars = users.map(() => createCookieJar());
    const userIds: string[] = [];

    try {
      for (const user of users) {
        const created = await admin.auth.admin.createUser({
          email: user.email,
          email_confirm: true,
          password: user.password,
        });
        if (created.error || !created.data.user) {
          throw new Error(
            `could not create parallel reset user (${created.error?.code ?? "unknown"})`,
          );
        }
        userIds.push(created.data.user.id);
      }

      const callbacks = await Promise.all(
        users.map((user, index) =>
          requestResetCallback(
            user.email,
            createBrowserSupabase(jars[index]),
            jars[index],
          ),
        ),
      );
      const flowIds = callbacks.map((callback) =>
        callback.searchParams.get("sb_flow_id"),
      );
      expect(flowIds[0]).toBeTruthy();
      expect(flowIds[1]).toBeTruthy();
      expect(flowIds[0]).not.toBe(flowIds[1]);

      const crossA = await fetch(callbacks[0], {
        headers: { cookie: cookieHeader(jars[1]) },
        redirect: "manual",
      });
      const crossB = await fetch(callbacks[1], {
        headers: { cookie: cookieHeader(jars[0]) },
        redirect: "manual",
      });
      expect(new URL(crossA.headers.get("location") ?? "").pathname).toBe("/");
      expect(new URL(crossB.headers.get("location") ?? "").pathname).toBe("/");

      const correctA = await fetch(callbacks[0], {
        headers: { cookie: cookieHeader(jars[0]) },
        redirect: "manual",
      });
      const correctB = await fetch(callbacks[1], {
        headers: { cookie: cookieHeader(jars[1]) },
        redirect: "manual",
      });
      expect(new URL(correctA.headers.get("location") ?? "").pathname).toBe(
        "/auth/update-password",
      );
      expect(new URL(correctB.headers.get("location") ?? "").pathname).toBe(
        "/auth/update-password",
      );
    } finally {
      await Promise.all(
        userIds.map((userId) => admin.auth.admin.deleteUser(userId)),
      );
    }
  });
});
