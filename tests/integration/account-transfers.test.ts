// @vitest-environment node

import { randomBytes, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  listAccountBalances,
  setAccountOpeningBalance,
  sumTrackedAccountAssets,
} from "@/lib/finance/account-balances";
import {
  createAccountTransferWithResult,
  deleteAccountTransfer,
  getMonthlySummary,
  listAccountTransfers,
  listTransactions,
  restoreAccountTransfer,
  updateAccountTransfer,
  type AuthenticatedUserContext,
} from "@/lib/finance/transactions";
import type { Database } from "@/lib/supabase/database.types";

const runLocal = process.env.CATWALLET_RUN_LOCAL_TRANSFER_TESTS === "1";
const createdUserIds: string[] = [];
const today = new Date().toISOString().slice(0, 10);
const testMonth = today.slice(0, 7);
const openingDate = new Date(Date.now() - 86_400_000)
  .toISOString()
  .slice(0, 10);
const transferDate = today;

type Fixture = {
  client: SupabaseClient<Database>;
  context: AuthenticatedUserContext;
  destinationAccountId: string;
  sourceAccountId: string;
};

let admin: SupabaseClient<Database>;
let userA: Fixture;
let userB: Fixture;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing local integration variable: ${name}`);
  return value;
}

async function createFixture(label: string): Promise<Fixture> {
  const email = `catwallet-transfer-${label}-${randomUUID()}@example.test`;
  const password = `${randomBytes(24).toString("base64url")}Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (created.error || !created.data.user) {
    throw new Error("Local account transfer user provisioning failed");
  }
  createdUserIds.push(created.data.user.id);

  const client = createClient<Database>(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.user) {
    throw new Error("Local account transfer sign-in failed");
  }
  const accounts = await client
    .from("payment_methods")
    .insert([
      {
        balance_tracking_enabled: true,
        name: `Synthetic source ${label}`,
        type: "bank",
      },
      {
        balance_tracking_enabled: true,
        name: `Synthetic destination ${label}`,
        type: "cash",
      },
    ])
    .select("id, type");
  if (accounts.error || accounts.data.length !== 2) {
    throw new Error("Local account transfer accounts were not created");
  }
  const sourceAccountId = accounts.data.find(
    (account) => account.type === "bank",
  )!.id;
  const destinationAccountId = accounts.data.find(
    (account) => account.type === "cash",
  )!.id;
  const context: AuthenticatedUserContext = {
    claims: { sub: signedIn.data.user.id },
    createdAt: signedIn.data.user.created_at,
    supabase: client,
    user: signedIn.data.user,
    userId: signedIn.data.user.id,
  };
  await Promise.all([
    setAccountOpeningBalance({
      amount: 900,
      effectiveDate: openingDate,
      paymentMethodId: sourceAccountId,
      userContext: context,
    }),
    setAccountOpeningBalance({
      amount: 300,
      effectiveDate: openingDate,
      paymentMethodId: destinationAccountId,
      userContext: context,
    }),
  ]);
  return { client, context, destinationAccountId, sourceAccountId };
}

async function expectBalances(
  fixture: Fixture,
  sourceCents: number,
  destinationCents: number,
) {
  const balances = await listAccountBalances(fixture.context);
  expect(
    balances.find((item) => item.id === fixture.sourceAccountId)
      ?.currentBalanceCents,
  ).toBe(sourceCents);
  expect(
    balances.find((item) => item.id === fixture.destinationAccountId)
      ?.currentBalanceCents,
  ).toBe(destinationCents);
  expect(sumTrackedAccountAssets(balances).cents).toBe(120000);
}

describe.skipIf(!runLocal)("local account transfer ledger", () => {
  beforeAll(async () => {
    const localUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
    const parsed = new URL(localUrl);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "56431") {
      throw new Error("Account transfer integration is restricted to Dragg");
    }
    admin = createClient<Database>(
      localUrl,
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    userA = await createFixture("a");
    userB = await createFixture("b");
  });

  afterAll(async () => {
    await userA?.client.auth.signOut();
    await userB?.client.auth.signOut();
    for (const userId of createdUserIds) {
      const ledgerCleanup = await admin
        .from("transactions")
        .delete()
        .eq("user_id", userId);
      if (ledgerCleanup.error) {
        throw new Error(
          `Local account transfer ledger cleanup failed: ${ledgerCleanup.error.message}`,
        );
      }
      const transferCleanup = await admin
        .from("account_transfers")
        .delete()
        .eq("user_id", userId);
      if (transferCleanup.error) {
        throw new Error(
          `Local account transfer group cleanup failed: ${transferCleanup.error.message}`,
        );
      }
      const userCleanup = await admin.auth.admin.deleteUser(userId);
      if (userCleanup.error) {
        throw new Error(
          `Local account transfer user cleanup failed: ${userCleanup.error.message}`,
        );
      }
    }
  });

  it("moves assets atomically without affecting monthly financial totals", async () => {
    const idempotencyKey = randomUUID();
    const input = {
      amount: 175,
      date: transferDate,
      description: "Synthetic internal transfer",
      destinationAccountId: userA.destinationAccountId,
      idempotencyKey,
      notes: "Synthetic transfer fixture",
      sourceAccountId: userA.sourceAccountId,
    };
    const [created, replayed] = await Promise.all([
      createAccountTransferWithResult(input, userA.context),
      createAccountTransferWithResult(input, userA.context),
    ]);
    expect([created.replayed, replayed.replayed].sort()).toEqual([false, true]);
    expect(created.transferId).toBe(idempotencyKey);
    expect(replayed.transferId).toBe(idempotencyKey);

    await expectBalances(userA, 72500, 47500);
    expect(await getMonthlySummary(testMonth, userA.context)).toEqual({
      totalExpenses: 0,
      totalIncome: 0,
      totalSavings: 0,
    });
    const totalSaved = await userA.client.rpc("calculate_total_saved", {
      p_selected_month: openingDate,
    });
    expect(totalSaved.error).toBeNull();
    expect(Number(totalSaved.data)).toBe(0);

    const transactions = await listTransactions({
      month: testMonth,
      userContext: userA.context,
    });
    const transferRows = transactions.filter(
      (transaction) => transaction.transferId === idempotencyKey,
    );
    expect(transferRows).toHaveLength(2);
    expect(transferRows.map((row) => row.transferSide).sort()).toEqual([
      "in",
      "out",
    ]);
    expect(transferRows.every((row) => row.entryKind === "transfer")).toBe(
      true,
    );

    const updatedRevision = await updateAccountTransfer(
      {
        ...input,
        description: "Synthetic internal transfer updated",
        expectedRevision: 1,
        id: idempotencyKey,
      },
      userA.context,
    );
    expect(updatedRevision).toBe(2);
    await expect(
      updateAccountTransfer(
        {
          ...input,
          expectedRevision: 1,
          id: idempotencyKey,
        },
        userA.context,
      ),
    ).rejects.toThrow("transfer was modified by another request");

    const directChildEdit = await userA.client
      .from("transactions")
      .update({ amount: 1 })
      .eq("transfer_id", idempotencyKey)
      .eq("transfer_side", "out");
    expect(directChildEdit.error?.message).toContain(
      "transfer ledger rows must be changed through the transfer group",
    );

    expect(await deleteAccountTransfer(idempotencyKey, 2, userA.context)).toBe(
      3,
    );
    expect(await deleteAccountTransfer(idempotencyKey, 3, userA.context)).toBe(
      3,
    );
    await expectBalances(userA, 90000, 30000);
    expect(await listAccountTransfers({ userContext: userA.context })).toEqual(
      [],
    );
    expect(
      await listAccountTransfers({
        includeDeleted: true,
        userContext: userA.context,
      }),
    ).toHaveLength(1);

    expect(await restoreAccountTransfer(idempotencyKey, 3, userA.context)).toBe(
      4,
    );
    expect(await restoreAccountTransfer(idempotencyKey, 4, userA.context)).toBe(
      4,
    );
    await expectBalances(userA, 72500, 47500);

    expect(await listAccountTransfers({ userContext: userB.context })).toEqual(
      [],
    );
    await expect(
      deleteAccountTransfer(idempotencyKey, 4, userB.context),
    ).rejects.toThrow("account transfer was not found");
  });

  it("rejects cross-user and credit-account references", async () => {
    await expect(
      createAccountTransferWithResult(
        {
          amount: 10,
          date: transferDate,
          description: "Synthetic cross-user transfer",
          destinationAccountId: userB.destinationAccountId,
          idempotencyKey: randomUUID(),
          sourceAccountId: userA.sourceAccountId,
        },
        userA.context,
      ),
    ).rejects.toThrow("invalid_destination_account");

    const credit = await userA.client
      .from("payment_methods")
      .insert({ name: "Synthetic credit", type: "credit" })
      .select("id")
      .single();
    expect(credit.error).toBeNull();
    await expect(
      createAccountTransferWithResult(
        {
          amount: 10,
          date: transferDate,
          description: "Synthetic card transfer",
          destinationAccountId: credit.data!.id,
          idempotencyKey: randomUUID(),
          sourceAccountId: userA.sourceAccountId,
        },
        userA.context,
      ),
    ).rejects.toThrow("credit_account");
  });
});
