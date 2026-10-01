// @vitest-environment node

import { randomBytes, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { encryptDescription } from "@/lib/crypto/field-encryption";
import {
  createReimbursementWithResult,
  type AuthenticatedUserContext,
} from "@/lib/finance/transactions";
import type { Database } from "@/lib/supabase/database.types";

const runLocal = process.env.CATWALLET_RUN_LOCAL_REIMBURSEMENT_TESTS === "1";
const createdUserIds: string[] = [];
const transactionDate = new Date().toISOString().slice(0, 10);
const testMonth = transactionDate.slice(0, 7);
const selectedMonthDate = `${testMonth}-01`;

type Fixture = {
  categoryId: string;
  client: SupabaseClient<Database>;
  context: AuthenticatedUserContext;
  creditAccountId: string;
  receivingAccountId: string;
  userId: string;
};

let admin: SupabaseClient<Database>;
let userA: Fixture;
let userB: Fixture;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing local integration variable: ${name}`);
  return value;
}

async function createSyntheticAccounts(client: SupabaseClient<Database>) {
  const accounts = await client
    .from("payment_methods")
    .insert([
      {
        balance_tracking_enabled: false,
        name: "Synthetic card",
        type: "credit",
      },
      {
        balance_tracking_enabled: true,
        name: "Synthetic receiving account",
        type: "bank",
      },
    ])
    .select("id, type");
  if (accounts.error) throw new Error(accounts.error.message);
  const creditAccount = accounts.data.find(
    (account) => account.type === "credit",
  );
  const receivingAccount = accounts.data.find(
    (account) => account.type !== "credit",
  );
  if (!creditAccount || !receivingAccount) {
    throw new Error("Synthetic reimbursement accounts were not created");
  }
  return { creditAccount, receivingAccount };
}

async function getNeedsCategoryId(client: SupabaseClient<Database>) {
  const category = await client
    .from("categories")
    .select("id")
    .eq("group_type", "needs")
    .limit(1)
    .single();
  if (category.error || !category.data) {
    throw new Error("Local reimbursement category was not provisioned");
  }
  return category.data.id;
}

async function createFixture(label: string): Promise<Fixture> {
  const email = `catwallet-reimbursement-${label}-${randomUUID()}@example.test`;
  const password = `${randomBytes(24).toString("base64url")}Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (created.error || !created.data.user) {
    throw new Error("Local reimbursement user provisioning failed");
  }
  createdUserIds.push(created.data.user.id);

  const client = createClient<Database>(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.user) {
    throw new Error("Local reimbursement sign-in failed");
  }
  const [categoryId, accounts] = await Promise.all([
    getNeedsCategoryId(client),
    createSyntheticAccounts(client),
  ]);

  return {
    categoryId,
    client,
    context: {
      claims: { sub: signedIn.data.user.id },
      createdAt: signedIn.data.user.created_at,
      supabase: client,
      user: signedIn.data.user,
      userId: signedIn.data.user.id,
    },
    creditAccountId: accounts.creditAccount.id,
    receivingAccountId: accounts.receivingAccount.id,
    userId: signedIn.data.user.id,
  };
}

describe.skipIf(!runLocal)("local reimbursement ledger", () => {
  beforeAll(async () => {
    const localUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
    const parsed = new URL(localUrl);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "56431") {
      throw new Error("Reimbursement integration is restricted to Dragg");
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
    await Promise.all(
      createdUserIds.map((userId) => admin.auth.admin.deleteUser(userId)),
    );
  });

  it("keeps gross card debt, receiving cash, personal spending, and net cash consistent", async () => {
    const originalId = randomUUID();
    const original = await userA.client.from("transactions").insert({
      amount: 83.4,
      category_id: userA.categoryId,
      date: transactionDate,
      description: encryptDescription("Synthetic group order"),
      entry_kind: "purchase",
      id: originalId,
      kind: "expense",
      payment_method_id: userA.creditAccountId,
    });
    expect(original.error).toBeNull();

    const amounts = [20.1, 17.2, 13.3];
    const reimbursementIds = await Promise.all(
      amounts.map(async (amount, index) => {
        const idempotencyKey = randomUUID();
        const result = await createReimbursementWithResult(
          {
            amount,
            date: transactionDate,
            description: `Synthetic reimbursement ${index + 1}`,
            idempotencyKey,
            originalTransactionId: originalId,
            paymentMethod: userA.receivingAccountId,
          },
          userA.context,
        );
        expect(result).toEqual({
          replayed: false,
          transactionId: idempotencyKey,
        });
        return result.transactionId;
      }),
    );

    const replayKey = reimbursementIds[0];
    const replays = await Promise.all([
      createReimbursementWithResult(
        {
          amount: 20.1,
          date: transactionDate,
          description: "Synthetic reimbursement 1",
          idempotencyKey: replayKey,
          originalTransactionId: originalId,
          paymentMethod: userA.receivingAccountId,
        },
        userA.context,
      ),
      createReimbursementWithResult(
        {
          amount: 20.1,
          date: transactionDate,
          description: "Synthetic reimbursement 1",
          idempotencyKey: replayKey,
          originalTransactionId: originalId,
          paymentMethod: userA.receivingAccountId,
        },
        userA.context,
      ),
    ]);
    expect(replays.every((result) => result.replayed)).toBe(true);

    const rows = await userA.client
      .from("transactions")
      .select(
        "id, amount, kind, entry_kind, payment_method_id, related_transaction_id",
      )
      .or(`id.eq.${originalId},related_transaction_id.eq.${originalId}`)
      .is("deleted_at", null);
    expect(rows.error).toBeNull();
    const reimbursements = (rows.data ?? []).filter(
      (row) => row.entry_kind === "reimbursement",
    );
    const reimbursed = reimbursements.reduce(
      (sum, row) => sum + Number(row.amount),
      0,
    );
    expect(reimbursements).toHaveLength(3);
    expect(reimbursed).toBeCloseTo(50.6, 2);
    expect(83.4 - reimbursed).toBeCloseTo(32.8, 2);
    expect(
      reimbursements.every(
        (row) => row.payment_method_id === userA.receivingAccountId,
      ),
    ).toBe(true);
    expect(0 - (83.4 - reimbursed)).toBeCloseTo(50.6 - 83.4, 2);
    const totalSaved = await userA.client.rpc("calculate_total_saved", {
      p_selected_month: selectedMonthDate,
    });
    expect(totalSaved.error).toBeNull();
    expect(Number(totalSaved.data)).toBeCloseTo(-32.8, 2);

    await expect(
      createReimbursementWithResult(
        {
          amount: 32.81,
          date: transactionDate,
          description: "Synthetic over-reimbursement",
          idempotencyKey: randomUUID(),
          originalTransactionId: originalId,
          paymentMethod: userA.receivingAccountId,
        },
        userA.context,
      ),
    ).rejects.toThrow("reimbursement total exceeds original expense");

    await expect(
      createReimbursementWithResult(
        {
          amount: 1,
          date: transactionDate,
          description: "Synthetic cross-user reimbursement",
          idempotencyKey: randomUUID(),
          originalTransactionId: originalId,
          paymentMethod: userB.receivingAccountId,
        },
        userB.context,
      ),
    ).rejects.toThrow("invalid original expense for reimbursement owner");

    const blockedOriginalDelete = await userA.client
      .from("transactions")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", originalId);
    expect(blockedOriginalDelete.error?.message).toContain(
      "delete active reimbursements before deleting the original expense",
    );

    const deletedAt = new Date().toISOString();
    expect(
      (
        await userA.client
          .from("transactions")
          .update({ deleted_at: deletedAt })
          .in("id", reimbursementIds)
      ).error,
    ).toBeNull();
    expect(
      (
        await userA.client
          .from("transactions")
          .update({ deleted_at: deletedAt })
          .eq("id", originalId)
      ).error,
    ).toBeNull();
    expect(
      (
        await userA.client
          .from("transactions")
          .update({ deleted_at: null })
          .eq("id", originalId)
      ).error,
    ).toBeNull();
    expect(
      (
        await userA.client
          .from("transactions")
          .update({ deleted_at: null })
          .in("id", reimbursementIds)
      ).error,
    ).toBeNull();
  });
});
