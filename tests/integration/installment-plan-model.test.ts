// @vitest-environment node

import { randomBytes, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getInstallmentOverview } from "@/lib/finance/catwallet";
import type { Database } from "@/lib/supabase/database.types";

const runLocal =
  process.env.CATWALLET_RUN_LOCAL_INSTALLMENT_MODEL_TESTS === "1";
const createdUserIds: string[] = [];

type UserFixture = {
  categoryId: string;
  client: SupabaseClient<Database>;
  paymentMethodId: string;
  userId: string;
};

let admin: SupabaseClient<Database>;
let userA: UserFixture;
let userB: UserFixture;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing local integration variable: ${name}`);
  return value;
}

async function createFixture(label: string): Promise<UserFixture> {
  const email = `catwallet-installment-model-${label}-${randomUUID()}@example.test`;
  const password = `${randomBytes(24).toString("base64url")}Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (created.error || !created.data.user)
    throw new Error("Local installment model user provisioning failed");
  createdUserIds.push(created.data.user.id);

  const client = createClient<Database>(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error("Local installment model sign-in failed");

  const [category, paymentMethod] = await Promise.all([
    client.from("categories").select("id").limit(1).single(),
    client.from("payment_methods").select("id").limit(1).single(),
  ]);
  if (
    category.error ||
    !category.data ||
    paymentMethod.error ||
    !paymentMethod.data
  )
    throw new Error("Local installment defaults were not provisioned");

  return {
    categoryId: category.data.id,
    client,
    paymentMethodId: paymentMethod.data.id,
    userId: created.data.user.id,
  };
}

function planRow(fixture: UserFixture, idempotencyKey: string) {
  return {
    amount_mode: "per_installment",
    category_id: fixture.categoryId,
    current_installment: 10,
    current_occurrence_date: "2026-09-30",
    description: "encrypted synthetic installment",
    entered_amount: 137,
    idempotency_key: idempotencyKey,
    installment_amount: 137,
    payment_method_id: fixture.paymentMethodId,
    request_fingerprint: "0".repeat(64),
    total_amount: 1644,
    total_installments: 12,
  };
}

describe.skipIf(!runLocal)("local installment plan model", () => {
  beforeAll(async () => {
    const localUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
    const parsed = new URL(localUrl);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "56431")
      throw new Error("Installment model integration is restricted to Dragg");

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

  it("stores only current-or-future occurrence numbers and isolates owners", async () => {
    const plan = await userA.client
      .from("installment_plans")
      .insert(planRow(userA, randomUUID()))
      .select("id")
      .single();
    expect(plan.error).toBeNull();
    expect(plan.data).toBeTruthy();

    const future = await userA.client.from("installment_occurrences").insert([
      {
        amount: 137,
        due_date: "2026-10-30",
        installment_number: 11,
        plan_id: plan.data!.id,
        status: "planned",
      },
      {
        amount: 137,
        due_date: "2026-11-30",
        installment_number: 12,
        plan_id: plan.data!.id,
        status: "planned",
      },
    ]);
    expect(future.error).toBeNull();

    const historical = await userA.client
      .from("installment_occurrences")
      .insert({
        amount: 137,
        due_date: "2026-08-30",
        installment_number: 9,
        plan_id: plan.data!.id,
        status: "planned",
      });
    expect(historical.error?.message).toContain(
      "installment_number >= current_installment",
    );

    const otherUserRead = await userB.client
      .from("installment_plans")
      .select("id")
      .eq("id", plan.data!.id);
    expect(otherUserRead.error).toBeNull();
    expect(otherUserRead.data).toEqual([]);
  });

  it("rejects cross-user category and payment account references", async () => {
    const crossOwner = await userA.client.from("installment_plans").insert({
      ...planRow(userA, randomUUID()),
      category_id: userB.categoryId,
      payment_method_id: userB.paymentMethodId,
    });

    expect(crossOwner.error?.message).toContain(
      "invalid payment method for installment plan owner",
    );
  });

  it("keeps plan idempotency keys unique per owner", async () => {
    const idempotencyKey = randomUUID();
    const first = await userA.client
      .from("installment_plans")
      .insert(planRow(userA, idempotencyKey));
    const duplicate = await userA.client
      .from("installment_plans")
      .insert(planRow(userA, idempotencyKey));
    const otherOwner = await userB.client
      .from("installment_plans")
      .insert(planRow(userB, idempotencyKey));

    expect(first.error).toBeNull();
    expect(duplicate.error?.code).toBe("23505");
    expect(otherOwner.error).toBeNull();
  });

  it("soft-deletes and restores a completed plan as one idempotent group", async () => {
    const planId = randomUUID();
    const insertedPlan = await userA.client.from("installment_plans").insert({
      ...planRow(userA, randomUUID()),
      completed_at: new Date().toISOString(),
      id: planId,
      status: "completed",
    });
    expect(insertedPlan.error).toBeNull();
    const insertedOccurrences = await userA.client
      .from("installment_occurrences")
      .insert([
        {
          amount: 137,
          due_date: "2026-09-30",
          installment_number: 10,
          plan_id: planId,
          status: "planned",
        },
        {
          amount: 137,
          due_date: "2026-10-30",
          installment_number: 11,
          plan_id: planId,
          status: "planned",
        },
      ]);
    expect(insertedOccurrences.error).toBeNull();

    const preview = await userA.client.rpc("preview_delete_installment", {
      p_plan_id: planId,
    });
    expect(preview.data).toMatchObject({
      blockers: [],
      canDelete: true,
      occurrenceCount: 2,
      planId,
    });
    expect(
      (await userA.client.rpc("delete_installment", { p_plan_id: planId }))
        .error,
    ).toBeNull();
    expect(
      (await userA.client.rpc("delete_installment", { p_plan_id: planId }))
        .error,
    ).toBeNull();
    const deletedOccurrences = await userA.client
      .from("installment_occurrences")
      .select("deleted_at")
      .eq("plan_id", planId);
    expect(
      deletedOccurrences.data?.every((row) => row.deleted_at !== null),
    ).toBe(true);

    expect(
      (await userA.client.rpc("restore_installment", { p_plan_id: planId }))
        .error,
    ).toBeNull();
    expect(
      (await userA.client.rpc("restore_installment", { p_plan_id: planId }))
        .error,
    ).toBeNull();
    const restoredOccurrences = await userA.client
      .from("installment_occurrences")
      .select("deleted_at")
      .eq("plan_id", planId);
    expect(
      restoredOccurrences.data?.every((row) => row.deleted_at === null),
    ).toBe(true);
  });

  it("soft-deletes and restores the posted transaction with its completed plan", async () => {
    const planId = randomUUID();
    const transactionId = randomUUID();
    const transaction = await userA.client.from("transactions").insert({
      amount: 125,
      category_id: userA.categoryId,
      date: "2026-09-30",
      description: "encrypted synthetic posted installment",
      installment_group_id: planId,
      installment_number: 10,
      installment_total: 12,
      kind: "expense",
      payment_method_id: userA.paymentMethodId,
      id: transactionId,
    });
    expect(transaction.error).toBeNull();

    const plan = await userA.client.from("installment_plans").insert({
      ...planRow(userA, randomUUID()),
      completed_at: new Date().toISOString(),
      id: planId,
      status: "completed",
    });
    expect(plan.error).toBeNull();
    const occurrence = await userA.client
      .from("installment_occurrences")
      .insert({
        amount: 125,
        due_date: "2026-09-30",
        installment_number: 10,
        plan_id: planId,
        status: "posted",
        transaction_id: transactionId,
      });
    expect(occurrence.error).toBeNull();

    expect(
      (await userA.client.rpc("delete_installment", { p_plan_id: planId }))
        .error,
    ).toBeNull();
    const deletedOverview = await getInstallmentOverview(
      { supabase: userA.client, userId: userA.userId },
      { includeDeleted: true },
    );
    expect(
      deletedOverview.find((item) => item.groupId === planId),
    ).toMatchObject({
      archivedAt: expect.any(String),
      endDate: "2026-09-30",
    });
    const deletedTransaction = await userA.client
      .from("transactions")
      .select("deleted_at")
      .eq("id", transactionId)
      .single();
    expect(deletedTransaction.data?.deleted_at).not.toBeNull();

    expect(
      (await userA.client.rpc("restore_installment", { p_plan_id: planId }))
        .error,
    ).toBeNull();
    const restoredTransaction = await userA.client
      .from("transactions")
      .select("deleted_at")
      .eq("id", transactionId)
      .single();
    expect(restoredTransaction.data?.deleted_at).toBeNull();
  });

  it("blocks active plans and cross-owner group operations", async () => {
    const planId = randomUUID();
    const inserted = await userA.client
      .from("installment_plans")
      .insert({ ...planRow(userA, randomUUID()), id: planId });
    expect(inserted.error).toBeNull();

    const activePreview = await userA.client.rpc("preview_delete_installment", {
      p_plan_id: planId,
    });
    expect(activePreview.data).toMatchObject({
      blockers: ["active_plan"],
      canDelete: false,
    });
    expect(
      (await userA.client.rpc("delete_installment", { p_plan_id: planId }))
        .error,
    ).not.toBeNull();
    expect(
      (await userB.client.rpc("delete_installment", { p_plan_id: planId }))
        .error,
    ).not.toBeNull();
    expect(
      (await userB.client.rpc("restore_installment", { p_plan_id: planId }))
        .error,
    ).not.toBeNull();
  });
});
