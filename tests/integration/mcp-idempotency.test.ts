// @vitest-environment node

import { randomBytes, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/supabase/database.types";

const runLocal = process.env.CATWALLET_RUN_LOCAL_MCP_IDEMPOTENCY_TESTS === "1";
const createdUserIds: string[] = [];
let admin: SupabaseClient<Database>;
let client: SupabaseClient<Database>;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing local integration variable: ${name}`);
  return value;
}

describe.skipIf(!runLocal)("local MCP idempotency registry boundary", () => {
  beforeAll(async () => {
    const localUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
    if (!/^(https?:\/\/)?(localhost|127\.0\.0\.1|192\.168\.)/.test(localUrl))
      throw new Error(
        "MCP idempotency integration is restricted to local Supabase",
      );

    admin = createClient<Database>(
      localUrl,
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const email = `catwallet-mcp-audit-${randomUUID()}@example.test`;
    const password = `${randomBytes(24).toString("base64url")}Aa1!`;
    const created = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
    });
    if (created.error || !created.data.user)
      throw new Error("Local MCP audit user provisioning failed");
    createdUserIds.push(created.data.user.id);

    client = createClient<Database>(
      localUrl,
      requiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
      {
        auth: { autoRefreshToken: false, persistSession: false },
      },
    );
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw new Error("Local MCP audit user sign-in failed");
  });

  afterAll(async () => {
    await client?.auth.signOut();
    for (const userId of createdUserIds) {
      const deleted = await admin.auth.admin.deleteUser(userId);
      if (deleted.error) throw new Error("Local MCP audit user cleanup failed");
    }
  });

  it("keeps duplicate historical audit attempts without using them as a lock", async () => {
    const user = (await client.auth.getUser()).data.user;
    expect(user).not.toBeNull();
    const idempotencyKeyHash = "1".repeat(64);
    const requestFingerprint = "2".repeat(64);
    const rows = await client
      .from("mcp_mutation_audit")
      .insert([
        {
          action: "create",
          entity_id: randomUUID(),
          idempotency_key_hash: idempotencyKeyHash,
          request_fingerprint: requestFingerprint,
          success: true,
          tool_name: "create_transaction",
          user_id: user!.id,
        },
        {
          action: "create",
          entity_id: randomUUID(),
          idempotency_key_hash: idempotencyKeyHash,
          request_fingerprint: requestFingerprint,
          success: true,
          tool_name: "create_transaction",
          user_id: user!.id,
        },
      ])
      .select("id, idempotency_key_hash");

    expect(rows.error).toBeNull();
    expect(rows.data).toHaveLength(2);
    expect(new Set(rows.data?.map((row) => row.idempotency_key_hash))).toEqual(
      new Set([idempotencyKeyHash]),
    );

    const registry = await client
      .from("mcp_mutation_idempotency")
      .select("id")
      .eq("idempotency_key_hash", idempotencyKeyHash);
    expect(registry.error).toBeNull();
    expect(registry.data).toHaveLength(0);
  });
});
