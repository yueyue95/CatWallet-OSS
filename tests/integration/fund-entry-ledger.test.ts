// @vitest-environment node

import { randomBytes, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, afterEach, describe, expect, it } from "vitest";

import type { Database } from "@/lib/supabase/database.types";
import { deleteSinkingFund, updateSinkingFund } from "@/lib/finance/catwallet";
import { archiveGoal, updateGoal } from "@/lib/finance/transactions";

const runLocal = process.env.CATWALLET_RUN_LOCAL_FUND_LEDGER_TESTS === "1";

type Fixture = {
  goalId: string;
  sinkingFundId: string;
};

const createdUserIds: string[] = [];
let admin: SupabaseClient<Database>;
let clientA: SupabaseClient<Database>;
let clientB: SupabaseClient<Database>;
let fixtureA: Fixture;
let fixtureB: Fixture;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing local integration variable: ${name}`);
  return value;
}

async function createSignedInClient(label: string) {
  const email = `catwallet-ledger-${label}-${randomUUID()}@example.test`;
  const password = `${randomBytes(24).toString("base64url")}Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (created.error || !created.data.user)
    throw new Error("Local fund ledger user provisioning failed");
  createdUserIds.push(created.data.user.id);

  const client = createClient<Database>(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error("Local fund ledger sign-in failed");
  return client;
}

async function createFixture(client: SupabaseClient<Database>, label: string) {
  const goal = await client
    .from("goals")
    .insert({
      color: "#22C55E",
      deadline: "2030-01-01",
      icon: "🧪",
      name: `Ledger goal ${label}`,
      target_amount: 100,
    })
    .select("id")
    .single();
  if (goal.error || !goal.data) throw new Error("Local goal fixture failed");

  const sinkingFund = await client
    .from("sinking_funds")
    .insert({
      emoji: "🧪",
      monthly_target: 0,
      name: `Ledger fund ${label}`,
      target_amount: 100,
    })
    .select("id")
    .single();
  if (sinkingFund.error || !sinkingFund.data)
    throw new Error("Local sinking fund fixture failed");

  return { goalId: goal.data.id, sinkingFundId: sinkingFund.data.id };
}

async function rpc(
  client: SupabaseClient<Database>,
  name: "record_goal_fund_entry" | "record_sinking_fund_entry",
  args: Database["public"]["Functions"][typeof name]["Args"],
) {
  return client.rpc(name, args);
}

async function currentValues(
  client: SupabaseClient<Database>,
  fixture: Fixture,
) {
  const [goal, sinkingFund, goalEntries, sinkingEntries] = await Promise.all([
    client
      .from("goals")
      .select("current_amount")
      .eq("id", fixture.goalId)
      .single(),
    client
      .from("sinking_funds")
      .select("current_amount")
      .eq("id", fixture.sinkingFundId)
      .single(),
    client
      .from("goal_fund_entries")
      .select("amount")
      .eq("goal_id", fixture.goalId),
    client
      .from("sinking_fund_entries")
      .select("amount")
      .eq("sinking_fund_id", fixture.sinkingFundId),
  ]);
  expect(goal.error).toBeNull();
  expect(sinkingFund.error).toBeNull();
  expect(goalEntries.error).toBeNull();
  expect(sinkingEntries.error).toBeNull();
  return {
    goal: Number(goal.data?.current_amount),
    goalLedger: (goalEntries.data ?? []).reduce(
      (sum, row) => sum + Number(row.amount),
      0,
    ),
    sinking: Number(sinkingFund.data?.current_amount),
    sinkingLedger: (sinkingEntries.data ?? []).reduce(
      (sum, row) => sum + Number(row.amount),
      0,
    ),
  };
}

async function cleanupFixture(
  client: SupabaseClient<Database>,
  fixture: Fixture | undefined,
) {
  if (!fixture) return;
  const deletedGoal = await client
    .from("goals")
    .delete()
    .eq("id", fixture.goalId);
  if (deletedGoal.error) throw new Error("Local goal fixture cleanup failed");
  const deletedFund = await client
    .from("sinking_funds")
    .delete()
    .eq("id", fixture.sinkingFundId);
  if (deletedFund.error)
    throw new Error("Local sinking fund fixture cleanup failed");
}

async function financeContext(client: SupabaseClient<Database>) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user)
    throw new Error("Local fund ledger user lookup failed");
  return {
    createdAt: data.user.created_at,
    supabase: client,
    userId: data.user.id,
  };
}

describe.skipIf(!runLocal)("local fund entry ledger RPCs", () => {
  beforeAll(async () => {
    const localUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
    if (!/^(https?:\/\/)?(localhost|127\.0\.0\.1|192\.168\.)/.test(localUrl))
      throw new Error(
        "Fund ledger integration is restricted to local Supabase",
      );
    admin = createClient<Database>(
      localUrl,
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: { autoRefreshToken: false, persistSession: false },
      },
    );
    clientA = await createSignedInClient("a");
    clientB = await createSignedInClient("b");
  });

  afterEach(async () => {
    await cleanupFixture(clientA, fixtureA);
    await cleanupFixture(clientB, fixtureB);
    fixtureA = undefined as never;
    fixtureB = undefined as never;
  });

  afterAll(async () => {
    await clientA?.auth.signOut();
    await clientB?.auth.signOut();
    for (const userId of createdUserIds) {
      const deleted = await admin.auth.admin.deleteUser(userId);
      if (deleted.error)
        throw new Error("Local fund ledger user cleanup failed");
    }
  });

  it("keeps goal and sinking fund ledgers idempotent and balanced", async () => {
    fixtureA = await createFixture(clientA, "a");

    const goalFirst = await rpc(clientA, "record_goal_fund_entry", {
      p_amount: 25,
      p_entry_type: "contribution",
      p_goal_id: fixtureA.goalId,
      p_idempotency_key: "goal-contribution-1",
      p_note: "test",
    });
    expect(goalFirst.error).toBeNull();
    const goalReplay = await rpc(clientA, "record_goal_fund_entry", {
      p_amount: 25,
      p_entry_type: "contribution",
      p_goal_id: fixtureA.goalId,
      p_idempotency_key: "goal-contribution-1",
      p_note: "test",
    });
    expect(goalReplay.error).toBeNull();

    const sinkingFirst = await rpc(clientA, "record_sinking_fund_entry", {
      p_amount: 25,
      p_entry_type: "contribution",
      p_idempotency_key: "sinking-contribution-1",
      p_note: "test",
      p_sinking_fund_id: fixtureA.sinkingFundId,
    });
    expect(sinkingFirst.error).toBeNull();
    const sinkingReplay = await rpc(clientA, "record_sinking_fund_entry", {
      p_amount: 25,
      p_entry_type: "contribution",
      p_idempotency_key: "sinking-contribution-1",
      p_note: "test",
      p_sinking_fund_id: fixtureA.sinkingFundId,
    });
    expect(sinkingReplay.error).toBeNull();

    const goalConflict = await rpc(clientA, "record_goal_fund_entry", {
      p_amount: 20,
      p_entry_type: "contribution",
      p_goal_id: fixtureA.goalId,
      p_idempotency_key: "goal-contribution-1",
      p_note: "test",
    });
    expect(goalConflict.error?.code).toBe("23505");

    const sinkingConflict = await rpc(clientA, "record_sinking_fund_entry", {
      p_amount: 20,
      p_entry_type: "contribution",
      p_idempotency_key: "sinking-contribution-1",
      p_note: "test",
      p_sinking_fund_id: fixtureA.sinkingFundId,
    });
    expect(sinkingConflict.error?.code).toBe("23505");

    const values = await currentValues(clientA, fixtureA);
    expect(values).toEqual({
      goal: 25,
      goalLedger: 25,
      sinking: 25,
      sinkingLedger: 25,
    });
  });

  it("preserves balances and movement ledgers during metadata edits and archive", async () => {
    fixtureA = await createFixture(clientA, "metadata-update");
    const context = await financeContext(clientA);

    const goalContribution = await rpc(clientA, "record_goal_fund_entry", {
      p_amount: 1,
      p_entry_type: "contribution",
      p_goal_id: fixtureA.goalId,
      p_idempotency_key: randomUUID(),
      p_note: "metadata edit regression",
    });
    const sinkingContribution = await rpc(
      clientA,
      "record_sinking_fund_entry",
      {
        p_amount: 1,
        p_entry_type: "contribution",
        p_idempotency_key: randomUUID(),
        p_note: "metadata edit regression",
        p_sinking_fund_id: fixtureA.sinkingFundId,
      },
    );
    expect(goalContribution.error).toBeNull();
    expect(sinkingContribution.error).toBeNull();

    await Promise.all([
      updateGoal(
        {
          color: "#22C55E",
          deadline: "2030-01-01",
          icon: "🌿",
          id: fixtureA.goalId,
          name: "Edited ledger goal",
          targetAmount: 200,
        },
        context,
      ),
      updateSinkingFund(
        {
          emoji: "🌿",
          expectedUseDate: "2030-01-01",
          id: fixtureA.sinkingFundId,
          isEnabled: true,
          monthlyTarget: 20,
          name: "Edited ledger fund",
          notes: "metadata edit regression",
          targetAmount: 200,
        },
        context,
      ),
    ]);

    const beforeArchive = await currentValues(clientA, fixtureA);
    expect(beforeArchive).toEqual({
      goal: 1,
      goalLedger: 1,
      sinking: 1,
      sinkingLedger: 1,
    });

    await Promise.all([
      archiveGoal(fixtureA.goalId, context),
      deleteSinkingFund(fixtureA.sinkingFundId, context),
    ]);

    const [goal, sinkingFund, goalEntries, sinkingEntries] = await Promise.all([
      admin
        .from("goals")
        .select("current_amount, deleted_at")
        .eq("id", fixtureA.goalId)
        .single(),
      admin
        .from("sinking_funds")
        .select("current_amount, deleted_at")
        .eq("id", fixtureA.sinkingFundId)
        .single(),
      admin
        .from("goal_fund_entries")
        .select("id, amount")
        .eq("goal_id", fixtureA.goalId),
      admin
        .from("sinking_fund_entries")
        .select("id, amount")
        .eq("sinking_fund_id", fixtureA.sinkingFundId),
    ]);
    expect(goal.error).toBeNull();
    expect(sinkingFund.error).toBeNull();
    expect(goal.data).toMatchObject({ current_amount: 1 });
    expect(goal.data?.deleted_at).not.toBeNull();
    expect(sinkingFund.data).toMatchObject({ current_amount: 1 });
    expect(sinkingFund.data?.deleted_at).not.toBeNull();
    expect(goalEntries.data).toHaveLength(1);
    expect(sinkingEntries.data).toHaveLength(1);
  });

  it("rejects cross-user access and insufficient withdrawals atomically", async () => {
    fixtureA = await createFixture(clientA, "a");
    fixtureB = await createFixture(clientB, "b");

    const hiddenGoal = await clientB
      .from("goals")
      .select("id")
      .eq("id", fixtureA.goalId);
    expect(hiddenGoal.error).toBeNull();
    expect(hiddenGoal.data).toHaveLength(0);

    const crossUserGoal = await rpc(clientB, "record_goal_fund_entry", {
      p_amount: 10,
      p_entry_type: "contribution",
      p_goal_id: fixtureA.goalId,
      p_idempotency_key: "cross-user-goal",
      p_note: null,
    });
    expect(crossUserGoal.error?.message).toContain("Goal not found");

    const crossUserSinking = await rpc(clientB, "record_sinking_fund_entry", {
      p_amount: 10,
      p_entry_type: "contribution",
      p_idempotency_key: "cross-user-sinking",
      p_note: null,
      p_sinking_fund_id: fixtureA.sinkingFundId,
    });
    expect(crossUserSinking.error?.message).toContain("Sinking fund not found");

    const goalWithdrawal = await rpc(clientA, "record_goal_fund_entry", {
      p_amount: -1,
      p_entry_type: "withdrawal",
      p_goal_id: fixtureA.goalId,
      p_idempotency_key: "goal-overdraw",
      p_note: null,
    });
    expect(goalWithdrawal.error?.message).toContain(
      "Insufficient goal balance",
    );

    const sinkingWithdrawal = await rpc(clientA, "record_sinking_fund_entry", {
      p_amount: -1,
      p_entry_type: "withdrawal",
      p_idempotency_key: "sinking-overdraw",
      p_note: null,
      p_sinking_fund_id: fixtureA.sinkingFundId,
    });
    expect(sinkingWithdrawal.error?.message).toContain(
      "Insufficient sinking fund balance",
    );

    expect(await currentValues(clientA, fixtureA)).toEqual({
      goal: 0,
      goalLedger: 0,
      sinking: 0,
      sinkingLedger: 0,
    });
  });

  it("rolls back a ledger insert when a later constraint fails", async () => {
    fixtureA = await createFixture(clientA, "rollback");
    const tooLongNote = "x".repeat(501);

    const goalResult = await rpc(clientA, "record_goal_fund_entry", {
      p_amount: 10,
      p_entry_type: "contribution",
      p_goal_id: fixtureA.goalId,
      p_idempotency_key: "goal-rollback",
      p_note: tooLongNote,
    });
    expect(goalResult.error).not.toBeNull();

    const sinkingResult = await rpc(clientA, "record_sinking_fund_entry", {
      p_amount: 10,
      p_entry_type: "contribution",
      p_idempotency_key: "sinking-rollback",
      p_note: tooLongNote,
      p_sinking_fund_id: fixtureA.sinkingFundId,
    });
    expect(sinkingResult.error).not.toBeNull();

    expect(await currentValues(clientA, fixtureA)).toEqual({
      goal: 0,
      goalLedger: 0,
      sinking: 0,
      sinkingLedger: 0,
    });
  });
});
