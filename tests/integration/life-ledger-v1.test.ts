// @vitest-environment node

import { randomBytes, randomUUID } from "node:crypto";

import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  encryptDescription,
  encryptField,
} from "@/lib/crypto/field-encryption";
import { createTransaction } from "@/lib/finance/transactions";
import {
  getMonthlySummary,
  listTransactions,
  type AuthenticatedUserContext,
} from "@/lib/finance/transactions";
import {
  listAccountBalances,
  setAccountOpeningBalance,
} from "@/lib/finance/account-balances";
import {
  getTransactionImportBatch,
  importTransactionsMutation,
  previewTransactionImport,
  restoreTransactionImport,
  undoTransactionImport,
} from "@/mcp/butler-mutations";
import type { Database } from "@/lib/supabase/database.types";

const runLocal = process.env.CATWALLET_RUN_LOCAL_LIFE_LEDGER_TESTS === "1";
const localUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const admin = runLocal
  ? createClient<Database>(localUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;
const createdUserIds: string[] = [];
let clientA: SupabaseClient<Database>;
let clientB: SupabaseClient<Database>;
let contextA: AuthenticatedUserContext;
let contextB: AuthenticatedUserContext;
let userA: User;
let userB: User;

function makeContext(
  client: SupabaseClient<Database>,
  user: User,
): AuthenticatedUserContext {
  return {
    claims: { email: user.email ?? undefined, sub: user.id },
    createdAt: user.created_at,
    supabase: client,
    user,
    userId: user.id,
  };
}

async function createSignedInUser(label: string) {
  if (!admin) throw new Error("Local Supabase is not enabled.");
  const email = `life-ledger-${label}-${randomUUID()}@example.test`;
  const password = `${randomBytes(24).toString("base64url")}Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (created.error || !created.data.user)
    throw created.error ?? new Error("User creation failed");
  createdUserIds.push(created.data.user.id);

  const client = createClient<Database>(localUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.user)
    throw signedIn.error ?? new Error("User sign-in failed");
  return { client, user: signedIn.data.user };
}

async function defaultCategory(client: SupabaseClient<Database>) {
  const result = await client
    .from("categories")
    .select("id")
    .eq("group_type", "needs")
    .eq("is_default", true)
    .limit(1)
    .single();
  if (result.error || !result.data)
    throw result.error ?? new Error("Category missing");
  return result.data.id;
}

async function paymentAccount(
  client: SupabaseClient<Database>,
  type: "bank" | "credit",
) {
  const result = await client
    .from("payment_methods")
    .select("id")
    .eq("type", type)
    .is("deleted_at", null)
    .limit(1)
    .single();
  if (result.error || !result.data)
    throw result.error ?? new Error(`Missing ${type} account`);
  return result.data.id;
}

beforeAll(async () => {
  if (!runLocal) return;
  const hostname = new URL(localUrl).hostname;
  if (!/^(localhost|127\.0\.0\.1|192\.168\.)$/.test(hostname)) {
    throw new Error(
      "Life-ledger integration tests are restricted to local Supabase",
    );
  }
  const a = await createSignedInUser("a");
  const b = await createSignedInUser("b");
  clientA = a.client;
  clientB = b.client;
  userA = a.user;
  userB = b.user;
  contextA = makeContext(clientA, userA);
  contextB = makeContext(clientB, userB);
});

afterAll(async () => {
  await clientA?.auth.signOut();
  await clientB?.auth.signOut();
  for (const userId of createdUserIds) {
    const result = await admin?.auth.admin.deleteUser(userId);
    if (result?.error) throw result.error;
    const [transactions, batches] = await Promise.all([
      admin?.from("transactions").select("id").eq("user_id", userId),
      admin
        ?.from("transaction_import_batches")
        .select("id")
        .eq("user_id", userId),
    ]);
    if (transactions?.error) throw transactions.error;
    if (batches?.error) throw batches.error;
    expect(transactions?.data).toEqual([]);
    expect(batches?.data).toEqual([]);
  }
});

describe.skipIf(!runLocal)("local life-ledger v1", () => {
  it("keeps repayments separate from purchase-month spending", async () => {
    const categoryId = await defaultCategory(clientA);
    const bankId = await paymentAccount(clientA, "bank");
    const creditId = await paymentAccount(clientA, "credit");
    await clientA
      .from("payment_methods")
      .update({ balance_tracking_enabled: true })
      .eq("id", bankId);
    await clientA
      .from("payment_methods")
      .update({ closing_day: 3, due_day: 10 })
      .eq("id", creditId);
    await setAccountOpeningBalance({
      amount: 1000,
      effectiveDate: "2026-09-01",
      paymentMethodId: bankId,
      userContext: contextA,
    });
    expect(
      (await listAccountBalances(contextA)).find((item) => item.id === creditId)
        ?.currentLiability,
    ).toBe(0);

    await createTransaction(
      {
        amount: 120,
        category: categoryId,
        date: "2026-09-10",
        description: "Synthetic shoes",
        idempotencyKey: randomUUID(),
        installmentCount: 1,
        paymentMethod: creditId,
        type: "expense",
      },
      contextA,
    );
    const afterPurchase = await listAccountBalances(contextA);
    expect(
      afterPurchase.find((item) => item.id === bankId)?.currentBalance,
    ).toBe(1000);
    expect(
      afterPurchase.find((item) => item.id === creditId)?.currentLiability,
    ).toBe(120);
    const invoiceId = `credit-card-invoice:${creditId}:2026-10`;
    const repaymentKey = randomUUID();
    const firstRepayment = await clientA
      .from("transactions")
      .insert({
        amount: 40,
        date: "2026-10-01",
        description: encryptDescription("Synthetic card repayment"),
        entry_idempotency_key: repaymentKey,
        entry_kind: "repayment",
        kind: "expense",
        notes: encryptField(`invoice_advance:${invoiceId}`),
        payment_method_id: bankId,
        related_invoice_id: invoiceId,
        user_id: userA.id,
      })
      .select("id")
      .single();
    expect(firstRepayment.error).toBeNull();

    const duplicateRepayment = await clientA.from("transactions").insert({
      amount: 40,
      date: "2026-10-01",
      description: encryptDescription("Synthetic card repayment"),
      entry_idempotency_key: repaymentKey,
      entry_kind: "repayment",
      kind: "expense",
      notes: encryptField(`invoice_advance:${invoiceId}`),
      payment_method_id: bankId,
      related_invoice_id: invoiceId,
      user_id: userA.id,
    });
    expect(duplicateRepayment.error?.code).toBe("23505");
    const afterDuplicate = await listAccountBalances(contextA);
    expect(
      afterDuplicate.find((item) => item.id === bankId)?.currentBalance,
    ).toBe(960);
    expect(
      afterDuplicate.find((item) => item.id === creditId)?.currentLiability,
    ).toBe(80);

    const september = await getMonthlySummary("2026-09", contextA);
    const octoberBeforeFullPayment = await getMonthlySummary(
      "2026-10",
      contextA,
    );
    expect(september.totalExpenses).toBe(120);
    expect(octoberBeforeFullPayment.totalExpenses).toBe(0);
    expect(
      (await listAccountBalances(contextA)).find((item) => item.id === bankId)
        ?.currentBalance,
    ).toBe(960);

    const invoiceHistory = await listTransactions({
      includeCreditCardInvoices: true,
      includeFuture: true,
      includePrevious: true,
      month: "2026-10",
      preserveCreditCardInvoicePurchases: true,
      useFinancialMonth: false,
      userContext: contextA,
    });
    const rawRepayment = await clientA
      .from("transactions")
      .select("date, entry_kind, related_invoice_id, deleted_at")
      .eq("payment_method_id", bankId)
      .eq("user_id", userA.id);
    expect(rawRepayment.data).toEqual([
      expect.objectContaining({
        date: "2026-10-01",
        entry_kind: "repayment",
        related_invoice_id: invoiceId,
      }),
    ]);
    expect(
      invoiceHistory
        .filter((item) => item.entryKind === "repayment")
        .map((item) => ({
          entryKind: item.entryKind,
          relatedInvoiceId: item.relatedInvoiceId,
          notes: item.notes,
        })),
    ).toEqual([
      {
        entryKind: "repayment",
        relatedInvoiceId: invoiceId,
        notes: `invoice_advance:${invoiceId}`,
      },
    ]);
    const partialInvoice = invoiceHistory.find(
      (item) => item.isCreditCardInvoice,
    );
    expect(partialInvoice?.invoice).toMatchObject({
      paidAmount: 40,
      totalAmount: 120,
    });

    const fullRepayment = await clientA.from("transactions").insert({
      amount: 80,
      date: "2026-10-02",
      description: encryptDescription("Synthetic card repayment remainder"),
      entry_idempotency_key: randomUUID(),
      entry_kind: "repayment",
      kind: "expense",
      notes: encryptField(`invoice_advance:${invoiceId}`),
      payment_method_id: bankId,
      related_invoice_id: invoiceId,
      user_id: userA.id,
    });
    expect(fullRepayment.error).toBeNull();

    const afterFullPayment = await listTransactions({
      includeCreditCardInvoices: true,
      includeFuture: true,
      includePrevious: true,
      month: "2026-10",
      preserveCreditCardInvoicePurchases: true,
      useFinancialMonth: false,
      userContext: contextA,
    });
    expect(
      afterFullPayment.find((item) => item.isCreditCardInvoice),
    ).toBeUndefined();
    expect(
      afterFullPayment.filter((item) => item.entryKind === "repayment"),
    ).toHaveLength(2);
    expect(
      (await listAccountBalances(contextA)).find((item) => item.id === bankId)
        ?.currentBalance,
    ).toBe(880);
    expect(
      (await listAccountBalances(contextA)).find((item) => item.id === creditId)
        ?.currentLiability,
    ).toBe(0);

    const crossUserRows = await clientB
      .from("transactions")
      .select("id")
      .eq("id", firstRepayment.data?.id ?? "");
    expect(crossUserRows.error).toBeNull();
    expect(crossUserRows.data).toEqual([]);
  });

  it("previews and persists an owned import batch with replay, undo, and restore", async () => {
    const categoryId = await defaultCategory(clientA);
    const bankId = await paymentAccount(clientA, "bank");
    const rows = [
      {
        amount: 12,
        categoryId,
        date: "2026-09-11",
        description: "Synthetic import one",
        idempotencyKey: randomUUID(),
        notes: null,
        paymentAccountId: bankId,
        type: "expense" as const,
      },
      {
        amount: 18,
        categoryId,
        date: "2026-09-12",
        description: "Synthetic import two",
        idempotencyKey: randomUUID(),
        notes: null,
        paymentAccountId: bankId,
        type: "expense" as const,
      },
    ];
    const preview = await previewTransactionImport({ rows }, contextA);
    expect(preview).toMatchObject({
      counts: { create: 2, reject: 0, skip: 0 },
      impact: { count: 2, total: 30 },
    });

    const batchKey = randomUUID();
    const created = await importTransactionsMutation(
      { batchIdempotencyKey: batchKey, rows },
      contextA,
    );
    const batchId = created.result.batchId;
    const persisted = await clientA
      .from("transactions")
      .select("id, deleted_at")
      .eq("import_batch_id", batchId);
    expect(persisted.error).toBeNull();
    expect(persisted.data).toHaveLength(2);

    const replay = await importTransactionsMutation(
      { batchIdempotencyKey: batchKey, rows },
      contextA,
    );
    expect(replay.idempotencyResult).toBe("replayed");
    expect(
      (
        await clientA
          .from("transactions")
          .select("id")
          .eq("import_batch_id", batchId)
      ).data,
    ).toHaveLength(2);

    const impact = await getTransactionImportBatch({ batchId }, contextA);
    expect(impact.impact).toMatchObject({
      activeCount: 2,
      activeTotal: 30,
      totalCount: 2,
    });
    await undoTransactionImport(
      { batchId, idempotencyKey: randomUUID() },
      contextA,
    );
    expect(
      (
        await clientA
          .from("transactions")
          .select("id")
          .eq("import_batch_id", batchId)
          .is("deleted_at", null)
      ).data,
    ).toHaveLength(0);
    await restoreTransactionImport(
      { batchId, idempotencyKey: randomUUID() },
      contextA,
    );
    expect(
      (
        await clientA
          .from("transactions")
          .select("id")
          .eq("import_batch_id", batchId)
          .is("deleted_at", null)
      ).data,
    ).toHaveLength(2);
    await expect(
      getTransactionImportBatch({ batchId }, contextB),
    ).rejects.toThrow("Transaction import batch not found.");
  });
});
