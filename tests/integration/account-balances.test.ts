// @vitest-environment node

import { randomBytes, randomUUID } from "node:crypto";

import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  listAccountBalances,
  setAccountOpeningBalance,
} from "@/lib/finance/account-balances";
import type { AuthenticatedUserContext } from "@/lib/finance/transactions";

const runLocal = process.env.CATWALLET_RUN_LOCAL_ACCOUNT_BALANCE_TESTS === "1";
const localUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
let admin: SupabaseClient;
let clientA: SupabaseClient;
let clientB: SupabaseClient;
const userIds: string[] = [];

async function createUserClient() {
  const email = `catwallet-balance-${randomUUID()}@example.test`;
  const password = `${randomBytes(24).toString("base64url")}Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (created.error || !created.data.user) {
    throw new Error("Local account balance fixture provisioning failed");
  }
  userIds.push(created.data.user.id);

  const client = createSupabaseClient(localUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error)
    throw new Error("Local account balance fixture login failed");
  return client;
}

function context(
  client: SupabaseClient,
  userId: string,
): AuthenticatedUserContext {
  return {
    claims: { sub: userId },
    createdAt: null,
    supabase: client,
    user: { id: userId } as AuthenticatedUserContext["user"],
    userId,
  };
}

describe.skipIf(!runLocal)("local account balance boundaries", () => {
  beforeAll(async () => {
    const hostname = new URL(localUrl).hostname;
    if (!/^(localhost|127\.0\.0\.1|192\.168\.)/.test(hostname)) {
      throw new Error("Account balance tests are restricted to local Supabase");
    }
    if (!adminKey)
      throw new Error(
        "Local test service key is required for fixture provisioning",
      );
    admin = createSupabaseClient(localUrl, adminKey, {
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

  it("keeps opening balance outside transactions and is idempotent", async () => {
    const userId = (await clientA.auth.getUser()).data.user!.id;
    const account = await clientA
      .from("payment_methods")
      .select("id")
      .eq("type", "bank")
      .single();
    expect(account.error).toBeNull();

    const before = await clientA
      .from("transactions")
      .select("id", { count: "exact", head: true });
    expect(before.error).toBeNull();

    const input = {
      amount: "194.40",
      effectiveDate: "2026-09-19",
      paymentMethodId: account.data!.id,
      userContext: context(clientA, userId),
    };
    await setAccountOpeningBalance(input);
    await setAccountOpeningBalance(input);
    await expect(
      setAccountOpeningBalance({
        ...input,
        amount: "200.00",
      }),
    ).rejects.toThrow(
      "Opening balance already exists; use a balance adjustment for corrections.",
    );

    const after = await clientA
      .from("transactions")
      .select("id", { count: "exact", head: true });
    expect(after.count).toBe(before.count);

    const entries = await clientA
      .from("account_balance_entries")
      .select("id", { count: "exact", head: true })
      .eq("payment_method_id", account.data!.id)
      .eq("entry_type", "opening_balance");
    expect(entries.error).toBeNull();
    expect(entries.count).toBe(1);
  });

  it("updates current balance for a real expense and restores it after deletion", async () => {
    const userId = (await clientA.auth.getUser()).data.user!.id;
    const account = await clientA
      .from("payment_methods")
      .select("id")
      .eq("type", "bank")
      .single();
    const before = await listAccountBalances(context(clientA, userId));
    expect(
      before.find((item) => item.id === account.data!.id)?.currentBalanceCents,
    ).toBe(19440);

    const inserted = await clientA
      .from("transactions")
      .insert({
        amount: 12,
        date: "2026-09-20",
        description: "Local balance fixture",
        kind: "expense",
        payment_method_id: account.data!.id,
      })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();

    const afterExpense = await listAccountBalances(context(clientA, userId));
    expect(
      afterExpense.find((item) => item.id === account.data!.id)
        ?.currentBalanceCents,
    ).toBe(18240);

    const deleted = await clientA
      .from("transactions")
      .delete()
      .eq("id", inserted.data!.id);
    expect(deleted.error).toBeNull();

    const afterDelete = await listAccountBalances(context(clientA, userId));
    expect(
      afterDelete.find((item) => item.id === account.data!.id)
        ?.currentBalanceCents,
    ).toBe(19440);
  });

  it("keeps pre-opening transactions in history without changing current balance", async () => {
    const userId = (await clientA.auth.getUser()).data.user!.id;
    const account = await clientA
      .from("payment_methods")
      .select("id")
      .eq("type", "bank")
      .single();
    const before = await listAccountBalances(context(clientA, userId));
    expect(
      before.find((item) => item.id === account.data!.id)?.currentBalanceCents,
    ).toBe(19440);

    const inserted = await clientA
      .from("transactions")
      .insert([
        {
          amount: 25,
          date: "2026-09-18",
          description: "Before opening balance",
          kind: "expense",
          payment_method_id: account.data!.id,
        },
        {
          amount: 15,
          date: "2026-09-19",
          description: "On opening balance date",
          kind: "expense",
          payment_method_id: account.data!.id,
        },
        {
          amount: 12,
          date: "2026-09-20",
          description: "After opening balance",
          kind: "expense",
          payment_method_id: account.data!.id,
        },
      ])
      .select("id");
    expect(inserted.error).toBeNull();
    expect(inserted.data).toHaveLength(3);

    const after = await listAccountBalances(context(clientA, userId));
    expect(
      after.find((item) => item.id === account.data!.id)?.currentBalanceCents,
    ).toBe(18240);

    const transactionIds =
      inserted.data?.map((transaction) => transaction.id) ?? [];
    const deleted = await clientA
      .from("transactions")
      .delete()
      .in("id", transactionIds);
    expect(deleted.error).toBeNull();
  });

  it("keeps balances isolated across multiple accounts", async () => {
    const userId = (await clientA.auth.getUser()).data.user!.id;
    const createdAccount = await clientA
      .from("payment_methods")
      .insert({
        name: "Local secondary balance fixture",
        type: "bank",
        balance_tracking_enabled: true,
      })
      .select("id")
      .single();
    expect(createdAccount.error).toBeNull();

    const paymentMethodId = createdAccount.data!.id;
    await setAccountOpeningBalance({
      amount: "100.00",
      effectiveDate: "2026-09-19",
      paymentMethodId,
      userContext: context(clientA, userId),
    });
    const inserted = await clientA
      .from("transactions")
      .insert({
        amount: 10,
        date: "2026-09-20",
        description: "Secondary account fixture",
        kind: "expense",
        payment_method_id: paymentMethodId,
      })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();

    const balances = await listAccountBalances(context(clientA, userId));
    expect(
      balances.find((item) => item.id === paymentMethodId)?.currentBalanceCents,
    ).toBe(9000);
    expect(
      balances.find(
        (item) => item.id !== paymentMethodId && item.type === "bank",
      )?.currentBalanceCents,
    ).toBe(19440);

    await clientA.from("transactions").delete().eq("id", inserted.data!.id);
    await clientA
      .from("account_balance_entries")
      .delete()
      .eq("payment_method_id", paymentMethodId);
    await clientA.from("payment_methods").delete().eq("id", paymentMethodId);
  });

  it("prevents cross-user balance reads and writes", async () => {
    const otherAccount = await clientB
      .from("payment_methods")
      .select("id")
      .eq("type", "bank")
      .single();
    expect(otherAccount.error).toBeNull();

    const hidden = await clientA
      .from("account_balance_entries")
      .select("id")
      .eq("payment_method_id", otherAccount.data!.id);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);

    const forged = await clientA.from("account_balance_entries").insert({
      amount: 1,
      effective_date: "2026-09-19",
      entry_type: "opening_balance",
      payment_method_id: otherAccount.data!.id,
      user_id: (await clientB.auth.getUser()).data.user!.id,
    });
    expect(forged.error).not.toBeNull();
  });
});
