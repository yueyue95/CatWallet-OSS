// @vitest-environment node

import { randomBytes, randomUUID } from "node:crypto";

import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createTransactionAction } from "@/app/transactions/actions";
import { createClient } from "@/lib/supabase/server";
import {
  createTransactionMutation,
  deriveMcpTransactionId,
} from "@/mcp/mutations";
import { revalidatePath } from "next/cache";

const runLocal = process.env.CATWALLET_RUN_LOCAL_TRANSACTION_TESTS === "1";
const localUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
let admin: SupabaseClient;
let client: SupabaseClient;
let otherClient: SupabaseClient;
const createdUserIds: string[] = [];

async function createTestClient() {
  const email = `catwallet-create-${randomUUID()}@example.test`;
  const password = `${randomBytes(24).toString("base64url")}Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user)
    throw new Error("Local test provisioning failed");
  createdUserIds.push(created.data.user.id);
  const userClient = createSupabaseClient(localUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signedIn = await userClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signedIn.error) throw new Error("Local password login failed");
  return userClient;
}

function input(idempotencyKey = randomUUID()) {
  return {
    amount: 12.34,
    category: "none",
    date: new Date().toISOString().slice(0, 10),
    description: "Ephemeral create integration test",
    idempotencyKey,
    installmentCount: 1,
    paymentMethod: "none",
    type: "expense" as const,
  };
}

function previousMonthDate() {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 15))
    .toISOString()
    .slice(0, 10);
}

async function countRequest(transactionId: string) {
  const response = await client
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("id", transactionId);
  if (response.error) throw new Error("Local transaction count failed");
  return response.count;
}

describe.skipIf(!runLocal)(
  "local Supabase committed transaction boundary",
  () => {
    beforeAll(async () => {
      const hostname = new URL(localUrl).hostname;
      if (!/^(localhost|127\.0\.0\.1|192\.168\.)/.test(hostname)) {
        throw new Error(
          "Transaction integration tests are restricted to local Supabase",
        );
      }
      admin = createSupabaseClient(localUrl, adminKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      client = await createTestClient();
      otherClient = await createTestClient();
    });

    beforeEach(() => {
      vi.mocked(revalidatePath).mockReset();
      vi.mocked(createClient).mockResolvedValue(client);
    });

    afterAll(async () => {
      await client?.auth.signOut();
      await otherClient?.auth.signOut();
      for (const id of createdUserIds) {
        const deleted = await admin.auth.admin.deleteUser(id);
        if (deleted.error) throw new Error("Ephemeral test cleanup failed");
      }
    });

    it("A: creates exactly one row and returns success", async () => {
      const request = input();
      const result = await createTransactionAction(request);
      expect(result).toEqual({
        ok: true,
        transactionId: request.idempotencyKey,
      });
      expect(await countRequest(result.transactionId)).toBe(1);
    });

    it("B: preserves one committed row and returns warning after revalidation failure", async () => {
      const request = input();
      vi.mocked(revalidatePath).mockImplementationOnce(() => {
        throw new Error("Injected cache failure");
      });
      const result = await createTransactionAction(request);
      expect(result).toEqual({
        ok: true,
        transactionId: request.idempotencyKey,
        warnings: ["revalidate"],
      });
      expect(await countRequest(result.transactionId)).toBe(1);
    });

    it("C: rejects a real database primary-key conflict without creating a row for this user", async () => {
      const request = input();
      const inserted = await otherClient.from("transactions").insert({
        id: request.idempotencyKey,
        date: request.date,
        description: "Ephemeral conflict fixture",
        amount: 1,
        kind: "expense",
      });
      expect(inserted.error).toBeNull();
      await expect(createTransactionAction(request)).rejects.toThrow(
        "Unable to save transaction",
      );
      expect(await countRequest(request.idempotencyKey)).toBe(0);
    });

    it("D: concurrent retries of the same request produce exactly one row", async () => {
      const request = input();
      const results = await Promise.all([
        createTransactionAction(request),
        createTransactionAction(request),
      ]);
      expect(results).toEqual([
        { ok: true, transactionId: request.idempotencyKey },
        { ok: true, transactionId: request.idempotencyKey },
      ]);
      expect(await countRequest(request.idempotencyKey)).toBe(1);
    });

    it("allows a new user to create previous-month expense and income transactions", async () => {
      const date = previousMonthDate();
      const expenseRequest = {
        ...input(),
        date,
        description: "Ephemeral historical expense",
      };
      const incomeRequest = {
        ...input(),
        date,
        description: "Ephemeral historical income",
        type: "income" as const,
      };

      const expense = await createTransactionAction(expenseRequest);
      const income = await createTransactionAction(incomeRequest);
      const rows = await client
        .from("transactions")
        .select("id, date, kind")
        .in("id", [expense.transactionId, income.transactionId]);

      expect(rows.error).toBeNull();
      expect(rows.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ date, kind: "expense" }),
          expect.objectContaining({ date, kind: "income" }),
        ]),
      );
    });

    it("uses the same historical-date rule through authenticated MCP and replays idempotently", async () => {
      const date = previousMonthDate();
      const category = await client
        .from("categories")
        .select("id")
        .eq("group_type", "needs")
        .is("deleted_at", null)
        .limit(1)
        .single();
      const paymentMethod = await client
        .from("payment_methods")
        .select("id")
        .is("deleted_at", null)
        .limit(1)
        .single();
      const user = (await client.auth.getUser()).data.user;
      expect(category.error).toBeNull();
      expect(paymentMethod.error).toBeNull();
      expect(user).not.toBeNull();

      const input = {
        amount: 7.89,
        categoryId: category.data!.id,
        countsTowardFunMoney: false,
        date,
        description: "Ephemeral MCP historical expense",
        idempotencyKey: randomUUID(),
        paymentAccountId: paymentMethod.data!.id,
        type: "expense" as const,
      };
      const context = {
        claims: { sub: user!.id },
        createdAt: user!.created_at ?? null,
        supabase: client,
        user,
        userId: user!.id,
      };

      const first = await createTransactionMutation(input, context);
      const second = await createTransactionMutation(input, context);
      expect(first).toMatchObject({
        idempotencyResult: "created",
        transaction: { date, type: "expense" },
      });
      expect(second).toMatchObject({
        idempotencyResult: "replayed",
        transaction: { id: first.transaction.id, date },
      });

      const count = await client
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("id", first.transaction.id);
      expect(count.error).toBeNull();
      expect(count.count).toBe(1);
      const deleted = await client
        .from("transactions")
        .delete()
        .eq("id", first.transaction.id);
      expect(deleted.error).toBeNull();
    });

    it("rejects a different MCP payload with the same key and serializes concurrency", async () => {
      const user = (await client.auth.getUser()).data.user;
      expect(user).not.toBeNull();
      const context = {
        claims: { sub: user!.id },
        createdAt: user!.created_at ?? null,
        supabase: client,
        user,
        userId: user!.id,
      };
      const base = {
        amount: 4.56,
        categoryId: null,
        countsTowardFunMoney: false,
        date: previousMonthDate(),
        description: "Ephemeral MCP idempotency fixture",
        idempotencyKey: randomUUID(),
        paymentAccountId: null,
        type: "expense" as const,
      };

      const first = await createTransactionMutation(base, context);
      await expect(
        createTransactionMutation({ ...base, amount: 5.67 }, context),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      const concurrent = {
        ...base,
        amount: 8.9,
        idempotencyKey: randomUUID(),
      };
      const results = await Promise.allSettled([
        createTransactionMutation(concurrent, context),
        createTransactionMutation(concurrent, context),
      ]);
      expect(
        results.filter(
          (result) =>
            result.status === "fulfilled" &&
            result.value.idempotencyResult === "created",
        ),
      ).toHaveLength(1);
      expect(
        results.filter(
          (result) =>
            (result.status === "fulfilled" &&
              result.value.idempotencyResult === "replayed") ||
            (result.status === "rejected" &&
              result.reason?.code === "CONFLICT"),
        ),
      ).toHaveLength(1);

      const firstRow = await client
        .from("transactions")
        .select("id")
        .eq("id", first.transaction.id);
      expect(firstRow.error).toBeNull();
      expect(firstRow.data).toHaveLength(1);
      const concurrentRow = await client
        .from("transactions")
        .select("id")
        .eq("id", deriveMcpTransactionId(user!.id, concurrent.idempotencyKey));
      expect(concurrentRow.error).toBeNull();
      expect(concurrentRow.data).toHaveLength(1);
    });

    it("E: creates per-installment metadata and keeps every amount equal", async () => {
      const request = {
        ...input(),
        amount: 500,
        currentInstallment: 5,
        date: "2030-01-15",
        installmentAmountMode: "per_installment" as const,
        installmentCount: 6,
      };
      const result = await createTransactionAction(request);
      const rows = await client
        .from("transactions")
        .select(
          "amount, installment_amount, installment_amount_mode, installment_current_number, installment_number, installment_total",
        )
        .eq(
          "installment_group_id",
          (
            await client
              .from("transactions")
              .select("installment_group_id")
              .eq("id", result.transactionId)
              .single()
          ).data?.installment_group_id ?? "",
        )
        .order("installment_number");
      expect(rows.error).toBeNull();
      expect(rows.data?.map((row) => Number(row.amount))).toEqual([
        500, 500, 500, 500, 500, 500,
      ]);
      expect(
        rows.data?.every(
          (row) => row.installment_amount_mode === "per_installment",
        ),
      ).toBe(true);
      expect(
        rows.data?.every((row) => Number(row.installment_amount) === 500),
      ).toBe(true);
      expect(
        rows.data?.every((row) => row.installment_current_number === 5),
      ).toBe(true);
    });

    it("F: keeps legacy total mode rounding when explicitly selected", async () => {
      const request = {
        ...input(),
        amount: 500,
        date: "2030-01-15",
        installmentAmountMode: "total" as const,
        installmentCount: 6,
      };
      const result = await createTransactionAction(request);
      const first = await client
        .from("transactions")
        .select("installment_group_id")
        .eq("id", result.transactionId)
        .single();
      const rows = await client
        .from("transactions")
        .select("amount, installment_amount_mode, installment_amount")
        .eq("installment_group_id", first.data?.installment_group_id ?? "")
        .order("installment_number");
      expect(rows.data?.map((row) => Number(row.amount))).toEqual([
        83.33, 83.33, 83.33, 83.33, 83.33, 83.35,
      ]);
      expect(
        rows.data?.every((row) => row.installment_amount_mode === "total"),
      ).toBe(true);
    });
  },
);
