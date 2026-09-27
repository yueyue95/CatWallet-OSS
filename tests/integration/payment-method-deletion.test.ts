// @vitest-environment node

import { randomBytes, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runLocal =
  process.env.CATWALLET_RUN_LOCAL_PAYMENT_METHOD_DELETION_TESTS === "1";
const localUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

let admin: SupabaseClient;
let clientA: SupabaseClient;
let clientB: SupabaseClient;
const userIds: string[] = [];

async function createUserClient() {
  const email = `catwallet-payment-delete-${randomUUID()}@example.test`;
  const password = `${randomBytes(24).toString("base64url")}Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (created.error || !created.data.user) {
    throw new Error("Local payment deletion fixture provisioning failed");
  }
  userIds.push(created.data.user.id);

  const client = createClient(localUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) {
    throw new Error("Local payment deletion fixture login failed");
  }
  return client;
}

async function createAccount(client: SupabaseClient, name: string) {
  const created = await client
    .from("payment_methods")
    .insert({ name, type: "bank" })
    .select("id")
    .single();
  expect(created.error).toBeNull();
  return created.data!.id as string;
}

async function addBalanceHistory(
  client: SupabaseClient,
  paymentMethodId: string,
) {
  const opening = await client.from("account_balance_entries").insert({
    amount: 100,
    effective_date: "2026-09-19",
    entry_type: "opening_balance",
    payment_method_id: paymentMethodId,
  });
  expect(opening.error).toBeNull();

  const adjustment = await client.from("account_balance_entries").insert({
    amount: 1,
    effective_date: "2026-09-20",
    entry_type: "adjustment",
    payment_method_id: paymentMethodId,
  });
  expect(adjustment.error).toBeNull();
}

async function deleteAccount(client: SupabaseClient, paymentMethodId: string) {
  return client.rpc("delete_payment_method_if_empty", {
    p_payment_method_id: paymentMethodId,
  });
}

describe.skipIf(!runLocal)("local payment method deletion", () => {
  beforeAll(async () => {
    const hostname = new URL(localUrl).hostname;
    if (!/^(localhost|127\.0\.0\.1|192\.168\.)/.test(hostname)) {
      throw new Error(
        "Payment deletion tests are restricted to local Supabase",
      );
    }
    if (!serviceRoleKey) {
      throw new Error("Local payment deletion tests require a service key");
    }
    admin = createClient(localUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    clientA = await createUserClient();
    clientB = await createUserClient();
  });

  afterAll(async () => {
    await clientA?.auth.signOut();
    await clientB?.auth.signOut();
    for (const userId of userIds) {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  it("rejects active transactions and rolls back cleanup history", async () => {
    const paymentMethodId = await createAccount(
      clientA,
      "Active deletion fixture",
    );
    await addBalanceHistory(clientA, paymentMethodId);
    const transaction = await clientA
      .from("transactions")
      .insert({
        amount: 5,
        date: "2026-09-20",
        description: "Active deletion fixture",
        kind: "expense",
        payment_method_id: paymentMethodId,
      })
      .select("id")
      .single();
    expect(transaction.error).toBeNull();

    const rejected = await deleteAccount(clientA, paymentMethodId);
    expect(rejected.error?.message).toContain("has transactions");

    const unchanged = await clientA
      .from("account_balance_entries")
      .select("id", { count: "exact", head: true })
      .eq("payment_method_id", paymentMethodId);
    expect(unchanged.error).toBeNull();
    expect(unchanged.count).toBe(2);

    await clientA.from("transactions").delete().eq("id", transaction.data!.id);
    const cleaned = await deleteAccount(clientA, paymentMethodId);
    expect(cleaned.error).toBeNull();
  });

  it("removes soft-deleted transactions and balance history atomically", async () => {
    const paymentMethodId = await createAccount(
      clientA,
      "Soft deletion fixture",
    );
    await addBalanceHistory(clientA, paymentMethodId);
    const transaction = await clientA
      .from("transactions")
      .insert({
        amount: 5,
        date: "2026-09-20",
        deleted_at: new Date().toISOString(),
        description: "Soft deletion fixture",
        kind: "expense",
        payment_method_id: paymentMethodId,
      })
      .select("id")
      .single();
    expect(transaction.error).toBeNull();

    const cleaned = await deleteAccount(clientA, paymentMethodId);
    expect(cleaned.error).toBeNull();

    const remainingAccount = await clientA
      .from("payment_methods")
      .select("id")
      .eq("id", paymentMethodId);
    const remainingEntries = await clientA
      .from("account_balance_entries")
      .select("id")
      .eq("payment_method_id", paymentMethodId);
    const remainingTransaction = await clientA
      .from("transactions")
      .select("id")
      .eq("id", transaction.data!.id);
    expect(remainingAccount.data).toEqual([]);
    expect(remainingEntries.data).toEqual([]);
    expect(remainingTransaction.data).toEqual([]);
  });

  it("does not allow another user to delete or observe the account", async () => {
    const paymentMethodId = await createAccount(
      clientA,
      "Cross-user deletion fixture",
    );
    await addBalanceHistory(clientA, paymentMethodId);

    const rejected = await deleteAccount(clientB, paymentMethodId);
    expect(rejected.error?.message).toContain("Payment method not found");

    const hiddenAccount = await clientB
      .from("payment_methods")
      .select("id")
      .eq("id", paymentMethodId);
    const visibleToOwner = await clientA
      .from("payment_methods")
      .select("id")
      .eq("id", paymentMethodId);
    expect(hiddenAccount.data).toEqual([]);
    expect(visibleToOwner.data).toHaveLength(1);

    const cleaned = await deleteAccount(clientA, paymentMethodId);
    expect(cleaned.error).toBeNull();
  });
});
