import { randomUUID } from "node:crypto";

import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  encryptDescription,
  encryptField,
} from "@/lib/crypto/field-encryption";
import {
  createFixedCommitment,
  createSinkingFund,
  deleteFixedCommitment,
  deleteSinkingFund,
  getCatWalletDashboardData,
  getFunMoneyOverview,
  listFixedCommitments,
  listSinkingFunds,
  recordFixedCommitmentPayment,
  setFunMoneyBudget,
  updateFixedCommitment,
  updateSinkingFund,
  upsertInstallmentRetirementAllocation,
} from "@/lib/finance/catwallet";
import { listAccountBalances } from "@/lib/finance/account-balances";
import { defaultReadModels } from "@/mcp/services";
import {
  abandonCoolingItem,
  createCoolingItem,
  listCoolingItems,
  markCoolingItemPurchased,
} from "@/lib/finance/cooling";
import { getMonthlyReport } from "@/lib/finance/monthly-report";
import type { AuthenticatedUserContext } from "@/lib/finance/transactions";
import type { Database } from "@/lib/supabase/database.types";
import {
  completeInstallment,
  deleteTransaction,
  listPaymentMethodOverview,
  listTransactions,
  restoreTransaction,
} from "@/lib/finance/transactions";
import { createStaticMcpAuthProvider } from "@/mcp/auth/context";
import { createReadOnlyMcpServer } from "@/mcp/server";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const localUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const publishableKey = requiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

const password = "CatWalletLocalTest!2026";
const emailA = "cat-a@example.test";
const emailB = "cat-b@example.test";

const admin = createClient<Database>(localUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let clientA: SupabaseClient<Database>;
let clientB: SupabaseClient<Database>;
let userA: User;
let userB: User;
let contextA: AuthenticatedUserContext;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value)
    throw new Error(`Missing integration test environment variable: ${name}`);
  return value;
}

function createUserClient() {
  return createClient<Database>(localUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

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

async function removeUserByEmail(email: string) {
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 100,
  });
  if (error) throw error;

  const user = data.users.find((candidate) => candidate.email === email);
  if (!user) return;

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) throw deleteError;
}

async function signUpAndSignIn(
  client: SupabaseClient<Database>,
  email: string,
) {
  const { data: signUpData, error: signUpError } = await client.auth.signUp({
    email,
    password,
    options: { data: { full_name: email.split("@")[0] } },
  });
  if (signUpError) throw signUpError;
  if (!signUpData.user) throw new Error(`No user returned for ${email}`);

  const { data: signInData, error: signInError } =
    await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  if (!signInData.user)
    throw new Error(`No signed-in user returned for ${email}`);
  return signInData.user;
}

async function defaultCategory(
  client: SupabaseClient<Database>,
  groupType: "income" | "needs",
) {
  const { data, error } = await client
    .from("categories")
    .select("id")
    .eq("group_type", groupType)
    .eq("is_default", true)
    .limit(1)
    .single();
  if (error) throw error;
  return data;
}

async function defaultPaymentMethod(client: SupabaseClient<Database>) {
  const { data, error } = await client
    .from("payment_methods")
    .select("id")
    .eq("name", "Cash")
    .limit(1)
    .single();
  if (error) throw error;
  return data;
}

beforeAll(async () => {
  await removeUserByEmail(emailA);
  await removeUserByEmail(emailB);

  clientA = createUserClient();
  clientB = createUserClient();
  userA = await signUpAndSignIn(clientA, emailA);
  userB = await signUpAndSignIn(clientB, emailB);
  contextA = makeContext(clientA, userA);
});

afterAll(async () => {
  await clientA?.auth.signOut();
  await clientB?.auth.signOut();
  await removeUserByEmail(emailA);
  await removeUserByEmail(emailB);
});

describe("local Supabase Auth and onboarding", () => {
  it("supports A/B login, refresh, logout, and onboarding triggers", async () => {
    const sessionA = await clientA.auth.getSession();
    expect(sessionA.error).toBeNull();
    expect(sessionA.data.session?.user.id).toBe(userA.id);

    const sessionB = await clientB.auth.getSession();
    expect(sessionB.error).toBeNull();
    expect(sessionB.data.session?.user.id).toBe(userB.id);

    const refreshed = await clientA.auth.refreshSession();
    expect(refreshed.error).toBeNull();
    expect(refreshed.data.session?.user.id).toBe(userA.id);

    const signedOut = await clientA.auth.signOut();
    expect(signedOut.error).toBeNull();
    const afterSignOut = await clientA.auth.getSession();
    expect(afterSignOut.data.session).toBeNull();

    const signedInAgain = await clientA.auth.signInWithPassword({
      email: emailA,
      password,
    });
    expect(signedInAgain.error).toBeNull();
    expect(signedInAgain.data.session?.user.id).toBe(userA.id);

    const profile = await clientA
      .from("profiles")
      .select("id, email")
      .eq("id", userA.id)
      .single();
    expect(profile.error).toBeNull();
    expect(profile.data?.id).toBe(userA.id);
    // Migration 010 intentionally keeps profile PII application-encrypted and
    // leaves the database column null during the auth trigger.
    expect(profile.data?.email).toBeNull();

    const categories = await clientA
      .from("categories")
      .select("id")
      .eq("is_default", true);
    expect(categories.error).toBeNull();
    expect(categories.data?.length).toBeGreaterThan(0);

    const paymentMethods = await clientA
      .from("payment_methods")
      .select("id, name, type")
      .order("name");
    expect(paymentMethods.error).toBeNull();
    expect(paymentMethods.data?.map(({ name }) => name)).toEqual([
      "Bank",
      "Cash",
      "Credit Card",
      "Debit Card",
    ]);
    expect(paymentMethods.data?.some(({ type }) => type === "pix")).toBe(false);
  });
});

describe("local Supabase RLS and ownership", () => {
  it("isolates A/B records and blocks cross-user references", async () => {
    const categoryA = await clientA
      .from("categories")
      .insert({
        group_type: "needs",
        icon: "🧪",
        monthly_limit: 100,
        name: "A RLS category",
      })
      .select("id")
      .single();
    expect(categoryA.error).toBeNull();
    if (!categoryA.data) throw new Error("Category A was not created");

    const paymentA = await clientA
      .from("payment_methods")
      .insert({ name: "A RLS cash", type: "cash" })
      .select("id")
      .single();
    expect(paymentA.error).toBeNull();
    if (!paymentA.data) throw new Error("Payment method A was not created");

    const fixedA = await createFixedCommitment(
      {
        amount: 1000,
        cadence: "monthly",
        categoryId: categoryA.data.id,
        name: "A fixed commitment",
        paymentMethodId: paymentA.data.id,
        startDate: "2026-10-01",
      },
      contextA,
    );
    const sinkingA = await createSinkingFund(
      { emoji: "🧪", monthlyTarget: 0, name: "A sinking fund" },
      contextA,
    );
    const allocationA = await upsertInstallmentRetirementAllocation(
      {
        installmentGroupId: randomUUID(),
        monthlyAmount: 100,
        startsMonth: "2026-10",
        targetId: sinkingA.id,
        targetType: "sinking_fund",
      },
      contextA,
    );
    const transactionA = await clientA
      .from("transactions")
      .insert({
        amount: 25,
        category_id: categoryA.data.id,
        date: "2026-08-16",
        description: encryptDescription("A RLS transaction"),
        fixed_commitment_id: fixedA.id,
        kind: "expense",
        notes: encryptField("test-only"),
        payment_method_id: paymentA.data.id,
      })
      .select("id")
      .single();
    expect(transactionA.error).toBeNull();
    if (!transactionA.data) throw new Error("Transaction A was not created");

    const categoryB = await defaultCategory(clientB, "needs");
    const paymentB = await defaultPaymentMethod(clientB);
    const transactionB = await clientB
      .from("transactions")
      .insert({
        amount: 35,
        category_id: categoryB.id,
        date: "2026-08-16",
        description: encryptDescription("B RLS transaction"),
        kind: "expense",
        payment_method_id: paymentB.id,
      })
      .select("id")
      .single();
    expect(transactionB.error).toBeNull();
    if (!transactionB.data) throw new Error("Transaction B was not created");

    const hiddenTransaction = await clientB
      .from("transactions")
      .select("id")
      .eq("id", transactionA.data.id);
    expect(hiddenTransaction.error).toBeNull();
    expect(hiddenTransaction.data).toHaveLength(0);

    const hiddenFixed = await clientB
      .from("fixed_commitments")
      .select("id")
      .eq("id", fixedA.id);
    expect(hiddenFixed.error).toBeNull();
    expect(hiddenFixed.data).toHaveLength(0);

    const hiddenSinking = await clientB
      .from("sinking_funds")
      .select("id")
      .eq("id", sinkingA.id);
    expect(hiddenSinking.error).toBeNull();
    expect(hiddenSinking.data).toHaveLength(0);

    const hiddenAllocation = await clientB
      .from("installment_retirement_allocations")
      .select("id")
      .eq("id", allocationA.id);
    expect(hiddenAllocation.error).toBeNull();
    expect(hiddenAllocation.data).toHaveLength(0);

    const blockedUpdate = await clientB
      .from("fixed_commitments")
      .update({ name: "B must not update A" })
      .eq("id", fixedA.id)
      .select("id");
    expect(blockedUpdate.error).toBeNull();
    expect(blockedUpdate.data).toHaveLength(0);

    const blockedDelete = await clientB
      .from("sinking_funds")
      .delete()
      .eq("id", sinkingA.id)
      .select("id");
    expect(blockedDelete.error).toBeNull();
    expect(blockedDelete.data).toHaveLength(0);

    const aCannotReadB = await clientA
      .from("transactions")
      .select("id")
      .eq("id", transactionB.data.id);
    expect(aCannotReadB.error).toBeNull();
    expect(aCannotReadB.data).toHaveLength(0);

    const aCannotUpdateB = await clientA
      .from("transactions")
      .update({ amount: 36 })
      .eq("id", transactionB.data.id)
      .select("id");
    expect(aCannotUpdateB.error).toBeNull();
    expect(aCannotUpdateB.data).toHaveLength(0);

    const invalidCategoryReference = await clientB
      .from("transactions")
      .insert({
        amount: 10,
        category_id: categoryA.data.id,
        date: "2026-09-16",
        description: encryptDescription("invalid category reference"),
        kind: "expense",
        payment_method_id: paymentB.id,
      })
      .select("id");
    expect(invalidCategoryReference.error).not.toBeNull();

    const invalidPaymentReference = await clientB
      .from("transactions")
      .insert({
        amount: 10,
        category_id: categoryB.id,
        date: "2026-09-16",
        description: encryptDescription("invalid payment reference"),
        kind: "expense",
        payment_method_id: paymentA.data.id,
      })
      .select("id");
    expect(invalidPaymentReference.error).not.toBeNull();

    const invalidFixedReference = await clientB
      .from("fixed_commitments")
      .insert({
        amount: 100,
        cadence: "monthly",
        category_id: categoryA.data.id,
        name: "invalid fixed reference",
        payment_method_id: paymentA.data.id,
        start_date: "2026-09-01",
      })
      .select("id");
    expect(invalidFixedReference.error).not.toBeNull();

    const invalidSinkingReference = await clientB
      .from("installment_retirement_allocations")
      .insert({
        installment_group_id: randomUUID(),
        monthly_amount: 10,
        starts_month: "2026-10-01",
        target_id: sinkingA.id,
        target_type: "sinking_fund",
      })
      .select("id");
    expect(invalidSinkingReference.error).not.toBeNull();
  });
});

describe("local CatWallet CRUD and safe-to-spend", () => {
  it("persists CRUD and computes paid commitments without double-counting", async () => {
    const incomeCategory = await defaultCategory(clientA, "income");
    const expenseCategory = await defaultCategory(clientA, "needs");
    const paymentMethod = await defaultPaymentMethod(clientA);

    const budget = await clientA
      .from("monthly_budgets")
      .insert({ income: 5000, month: "2026-09-01", savings_limit: 300 })
      .select("id")
      .single();
    expect(budget.error).toBeNull();

    const income = await clientA
      .from("transactions")
      .insert({
        amount: 5000,
        category_id: incomeCategory.id,
        date: "2026-09-05",
        description: encryptDescription("test income"),
        kind: "income",
        payment_method_id: paymentMethod.id,
      })
      .select("id")
      .single();
    expect(income.error).toBeNull();

    const ordinaryExpense = await clientA
      .from("transactions")
      .insert({
        amount: 500,
        category_id: expenseCategory.id,
        date: "2026-09-06",
        description: encryptDescription("test ordinary expense"),
        kind: "expense",
        notes: encryptField("created for integration test"),
        payment_method_id: paymentMethod.id,
      })
      .select("id")
      .single();
    expect(ordinaryExpense.error).toBeNull();
    if (!ordinaryExpense.data)
      throw new Error("Ordinary expense was not created");

    const fixed = await createFixedCommitment(
      {
        amount: 1000,
        cadence: "monthly",
        categoryId: expenseCategory.id,
        name: "本地测试固定承诺",
        paymentMethodId: paymentMethod.id,
        startDate: "2026-09-16",
      },
      contextA,
    );
    const sinking = await createSinkingFund(
      { emoji: "🚗", monthlyTarget: 200, name: "测试车车基金" },
      contextA,
    );
    const dashboardBeforePayment = await getCatWalletDashboardData(
      "2026-09",
      contextA,
    );
    expect(dashboardBeforePayment.safeToSpend).toMatchObject({
      fixedCommitments: 1000,
      incomeIsForecast: false,
      paidFixedCommitments: 0,
      safeToSpend: 3000,
    });
    const mcpDashboard = await defaultReadModels.getDashboard(
      "2026-09",
      contextA,
    );
    const mcpSafeToSpend = await defaultReadModels.getSafeToSpend(
      "2026-09",
      contextA,
    );
    const mcpReport = await defaultReadModels.getMonthlyReport(
      userA.id,
      "2026-09",
      contextA,
    );
    expect(mcpDashboard.safeToSpend.safeToSpend).toBe(3000);
    expect(mcpDashboard.safeToSpend.incomeIsForecast).toBe(false);
    expect(mcpSafeToSpend.safeToSpend.safeToSpend).toBe(3000);
    expect(mcpReport.core).toMatchObject({ income: 5000, safeToSpend: 3000 });
    await recordFixedCommitmentPayment(
      {
        amount: 1000,
        commitmentId: fixed.id,
        date: "2026-09-07",
        description: "test fixed commitment payment",
      },
      contextA,
    );

    const installmentGroupId = randomUUID();
    const installmentRows = await clientA
      .from("transactions")
      .insert(
        [1, 2, 3].map((installmentNumber) => ({
          amount: 300,
          category_id: expenseCategory.id,
          date: `2026-${String(9 + installmentNumber).padStart(2, "0")}-01`,
          description: encryptDescription(
            `test installment ${installmentNumber}`,
          ),
          installment_group_id: installmentGroupId,
          installment_number: installmentNumber,
          installment_total: 3,
          kind: "expense" as const,
          payment_method_id: paymentMethod.id,
        })),
      )
      .select("id");
    expect(installmentRows.error).toBeNull();
    expect(installmentRows.data).toHaveLength(3);

    const allocation = await upsertInstallmentRetirementAllocation(
      {
        installmentGroupId,
        monthlyAmount: 100,
        startsMonth: "2026-10",
        targetType: "savings",
      },
      contextA,
    );
    const updatedAllocation = await upsertInstallmentRetirementAllocation(
      {
        installmentGroupId,
        monthlyAmount: 125,
        startsMonth: "2026-10",
        targetType: "savings",
      },
      contextA,
    );
    expect(updatedAllocation.id).toBe(allocation.id);
    expect(updatedAllocation.monthlyAmount).toBe(125);

    const duplicateSavings = await clientA
      .from("installment_retirement_allocations")
      .insert({
        installment_group_id: installmentGroupId,
        monthly_amount: 125,
        starts_month: "2026-10-01",
        target_type: "savings",
      })
      .select("id");
    expect(duplicateSavings.error).not.toBeNull();

    const dashboardBeforeStart = await getCatWalletDashboardData(
      "2026-08",
      contextA,
    );
    expect(dashboardBeforeStart.fixedCommitments).toEqual([]);

    const dashboard = await getCatWalletDashboardData("2026-09", contextA);
    expect(dashboard.fixedCommitments).toMatchObject([
      { monthlyAmount: 1000, paidAmount: 1000, remainingAmount: 0 },
    ]);
    expect(dashboard.safeToSpend).toMatchObject({
      fixedCommitments: 1000,
      futureReserves: 200,
      income: 5000,
      longTermSavings: 300,
      paidFixedCommitments: 1000,
      regularSpent: 500,
      safeToSpend: 3000,
      spent: 1500,
    });
    expect(dashboard.sinkingFunds.some((fund) => fund.id === sinking.id)).toBe(
      true,
    );

    const editedExpense = await clientA
      .from("transactions")
      .update({ notes: encryptField("edited integration test") })
      .eq("id", ordinaryExpense.data.id)
      .select("id")
      .single();
    expect(editedExpense.error).toBeNull();

    const editedFixed = await updateFixedCommitment(
      {
        amount: 1000,
        cadence: "monthly",
        categoryId: expenseCategory.id,
        id: fixed.id,
        name: "本地测试固定承诺（已编辑）",
        paymentMethodId: paymentMethod.id,
        startDate: "2026-09-01",
      },
      contextA,
    );
    expect(editedFixed.name).toContain("已编辑");

    const editedSinking = await updateSinkingFund(
      {
        emoji: "🚗",
        id: sinking.id,
        monthlyTarget: 250,
        name: "测试车车基金（已编辑）",
      },
      contextA,
    );
    expect(editedSinking.monthlyTarget).toBe(250);

    await deleteFixedCommitment(fixed.id, contextA);
    await deleteSinkingFund(sinking.id, contextA);

    expect(
      (await listFixedCommitments(contextA)).some(
        (item) => item.id === fixed.id,
      ),
    ).toBe(false);
    expect(
      (await listSinkingFunds(contextA)).some((item) => item.id === sinking.id),
    ).toBe(false);

    const persistedTransactions = await clientA
      .from("transactions")
      .select("id")
      .in("id", [income.data?.id, ordinaryExpense.data.id].filter(Boolean));
    expect(persistedTransactions.error).toBeNull();
    expect(persistedTransactions.data?.length).toBe(2);

    const persistedInstallments = await clientA
      .from("transactions")
      .select("id")
      .eq("installment_group_id", installmentGroupId);
    expect(persistedInstallments.error).toBeNull();
    expect(persistedInstallments.data).toHaveLength(3);

    const persistedAllocation = await clientA
      .from("installment_retirement_allocations")
      .select("monthly_amount")
      .eq("id", allocation.id)
      .single();
    expect(persistedAllocation.error).toBeNull();
    expect(persistedAllocation.data?.monthly_amount).toBe(125);

    const deletedFixed = await admin
      .from("fixed_commitments")
      .select("deleted_at, is_enabled")
      .eq("id", fixed.id)
      .single();
    expect(deletedFixed.error).toBeNull();
    expect(deletedFixed.data?.deleted_at).not.toBeNull();
    expect(deletedFixed.data?.is_enabled).toBe(false);

    const deletedSinking = await admin
      .from("sinking_funds")
      .select("deleted_at, is_enabled")
      .eq("id", sinking.id)
      .single();
    expect(deletedSinking.error).toBeNull();
    expect(deletedSinking.data?.deleted_at).not.toBeNull();
    expect(deletedSinking.data?.is_enabled).toBe(false);
  });

  it("uses monthly budget income only when no actual income transaction exists", async () => {
    const testEmail = `cat-income-selection-${randomUUID()}@example.test`;
    const testClient = createUserClient();
    const testUser = await signUpAndSignIn(testClient, testEmail);
    const testContext = makeContext(testClient, testUser);

    try {
      const incomeCategory = await defaultCategory(testClient, "income");
      const paymentMethod = await defaultPaymentMethod(testClient);
      const budgetRows = await testClient.from("monthly_budgets").upsert(
        [
          { income: 5000, month: "2025-10-01" },
          { income: 5000, month: "2025-12-01" },
        ],
        { onConflict: "user_id,month" },
      );
      expect(budgetRows.error).toBeNull();

      const actualIncomeRows = await testClient
        .from("transactions")
        .insert([
          {
            amount: 5000,
            category_id: incomeCategory.id,
            date: "2025-11-05",
            description: encryptDescription("actual-only monthly income"),
            kind: "income",
            payment_method_id: paymentMethod.id,
          },
          {
            amount: 6000,
            category_id: incomeCategory.id,
            date: "2025-12-05",
            description: encryptDescription("actual income overrides budget"),
            kind: "income",
            payment_method_id: paymentMethod.id,
          },
        ])
        .select("id");
      expect(actualIncomeRows.error).toBeNull();

      const mcpServer = createReadOnlyMcpServer({
        auth: createStaticMcpAuthProvider(testContext),
      });
      const mcpClient = new Client({
        name: "catwallet-income-read-test",
        version: "1.0.0",
      });
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await mcpServer.connect(serverTransport);
      await mcpClient.connect(clientTransport);

      for (const scenario of [
        {
          actualIncome: 0,
          expectedForecast: true,
          expectedIncome: 5000,
          month: "2025-10",
        },
        {
          actualIncome: 5000,
          expectedForecast: false,
          expectedIncome: 5000,
          month: "2025-11",
        },
        {
          actualIncome: 6000,
          expectedForecast: false,
          expectedIncome: 6000,
          month: "2025-12",
        },
      ]) {
        const [dashboard, mcpSafeToSpend, report] = await Promise.all([
          defaultReadModels.getDashboard(scenario.month, testContext),
          defaultReadModels.getSafeToSpend(scenario.month, testContext),
          defaultReadModels.getMonthlyReport(
            testUser.id,
            scenario.month,
            testContext,
          ),
        ]);
        expect(dashboard.safeToSpend.income).toBe(scenario.expectedIncome);
        expect(dashboard.safeToSpend.incomeIsForecast).toBe(
          scenario.expectedForecast,
        );
        expect(dashboard.safeToSpend.safeToSpend).toBe(scenario.expectedIncome);
        expect(mcpSafeToSpend.safeToSpend.income).toBe(scenario.expectedIncome);
        expect(mcpSafeToSpend.safeToSpend.incomeIsForecast).toBe(
          scenario.expectedForecast,
        );
        expect(mcpSafeToSpend.safeToSpend.safeToSpend).toBe(
          scenario.expectedIncome,
        );
        expect(report.core.income).toBe(scenario.actualIncome);
        expect(report.core.safeToSpend).toBe(scenario.expectedIncome);

        const [dashboardResult, safeToSpendResult, reportResult] =
          await Promise.all([
            mcpClient.callTool({
              arguments: { month: scenario.month },
              name: "get_dashboard_summary",
            }),
            mcpClient.callTool({
              arguments: { month: scenario.month },
              name: "get_safe_to_spend",
            }),
            mcpClient.callTool({
              arguments: { month: scenario.month },
              name: "get_monthly_report",
            }),
          ]);
        expect(dashboardResult.isError).not.toBe(true);
        expect(safeToSpendResult.isError).not.toBe(true);
        expect(reportResult.isError).not.toBe(true);
        const dashboardData = (
          dashboardResult.structuredContent as {
            data: {
              safeToSpend: {
                income: number;
                incomeIsForecast: boolean;
                safeToSpend: number;
              };
            };
          }
        ).data;
        const safeToSpendData = (
          safeToSpendResult.structuredContent as {
            data: {
              income: number;
              incomeIsForecast: boolean;
              safeToSpend: number;
            };
          }
        ).data;
        const reportData = (
          reportResult.structuredContent as {
            data: { core: { safeToSpend: number } };
          }
        ).data;
        expect(dashboardData.safeToSpend.income).toBe(scenario.expectedIncome);
        expect(dashboardData.safeToSpend.incomeIsForecast).toBe(
          scenario.expectedForecast,
        );
        expect(dashboardData.safeToSpend.safeToSpend).toBe(
          scenario.expectedIncome,
        );
        expect(safeToSpendData).toMatchObject({
          income: scenario.expectedIncome,
          incomeIsForecast: scenario.expectedForecast,
          safeToSpend: scenario.expectedIncome,
        });
        expect(reportData.core.safeToSpend).toBe(scenario.expectedIncome);
      }
    } finally {
      await testClient.auth.signOut();
      await removeUserByEmail(testEmail);
    }
  });
});

describe("local completed installment read models", () => {
  // Keep one lifecycle to compare read models at each transition.
  // eslint-disable-next-line complexity
  it("excludes completed future rows from read models and cumulative reports after deleting their anchors", async () => {
    const testEmail = `cat-installment-read-${randomUUID()}@example.test`;
    const testClient = createUserClient();
    const testUser = await signUpAndSignIn(testClient, testEmail);
    const testContext = makeContext(testClient, testUser);
    let mcpClient: Client | undefined;
    let mcpServer: ReturnType<typeof createReadOnlyMcpServer> | undefined;

    try {
      const category = await defaultCategory(testClient, "needs");
      const cash = await defaultPaymentMethod(testClient);
      const historicalExpenses = await testClient.from("transactions").insert([
        {
          amount: 487.36,
          category_id: category.id,
          date: "2026-07-01",
          description: encryptDescription("July historical card spending"),
          entry_kind: "purchase",
          kind: "expense",
          payment_method_id: cash.id,
        },
        {
          amount: 1784.52,
          category_id: category.id,
          date: "2026-08-01",
          description: encryptDescription("August historical card spending"),
          entry_kind: "purchase",
          kind: "expense",
          payment_method_id: cash.id,
        },
      ]);
      expect(historicalExpenses.error).toBeNull();
      const cardId = randomUUID();
      const card = await testClient
        .from("payment_methods")
        .insert({
          balance_tracking_enabled: true,
          closing_day: 7,
          credit_limit: 5000,
          due_day: 14,
          id: cardId,
          name: "Local installment read model card",
          type: "credit",
        })
        .select("id")
        .single();
      expect(card.error).toBeNull();

      const now = new Date();
      const year = now.getUTCFullYear();
      const monthNumber = now.getUTCMonth() + 1;
      const currentMonth = `${year}-${String(monthNumber).padStart(2, "0")}`;
      const today = now.toISOString().slice(0, 10);
      const following = new Date(Date.UTC(year, monthNumber, 1));
      const nextMonth = `${following.getUTCFullYear()}-${String(
        following.getUTCMonth() + 1,
      ).padStart(2, "0")}`;
      const groupPerInstallment = randomUUID();
      const groupTotal = randomUUID();
      const created = await testClient
        .from("transactions")
        .insert([
          {
            amount: 0.01,
            category_id: category.id,
            date: today,
            description: encryptDescription("local installment purchase 1/2"),
            entry_kind: "purchase",
            installment_amount: 0.01,
            installment_amount_mode: "per_installment",
            installment_current_number: 1,
            installment_group_id: groupPerInstallment,
            installment_number: 1,
            installment_total: 2,
            kind: "expense",
            notes: encryptField("1/2"),
            payment_method_id: cardId,
          },
          {
            amount: 0.01,
            category_id: category.id,
            date: `${nextMonth}-01`,
            description: encryptDescription("local installment purchase 2/2"),
            entry_kind: "purchase",
            installment_amount: 0.01,
            installment_amount_mode: "per_installment",
            installment_current_number: 1,
            installment_group_id: groupPerInstallment,
            installment_number: 2,
            installment_total: 2,
            kind: "expense",
            notes: encryptField("2/2"),
            payment_method_id: cardId,
          },
          {
            amount: 0.01,
            category_id: category.id,
            date: today,
            description: encryptDescription("local installment total 1/2"),
            entry_kind: "purchase",
            installment_amount: 0.02,
            installment_amount_mode: "total",
            installment_current_number: 1,
            installment_group_id: groupTotal,
            installment_number: 1,
            installment_total: 2,
            kind: "expense",
            notes: encryptField("1/2"),
            payment_method_id: cardId,
          },
          {
            amount: 0.01,
            category_id: category.id,
            date: `${nextMonth}-01`,
            description: encryptDescription("local installment total 2/2"),
            entry_kind: "purchase",
            installment_amount: 0.02,
            installment_amount_mode: "total",
            installment_current_number: 1,
            installment_group_id: groupTotal,
            installment_number: 2,
            installment_total: 2,
            kind: "expense",
            notes: encryptField("2/2"),
            payment_method_id: cardId,
          },
        ])
        .select("id, installment_group_id, installment_number");
      expect(created.error).toBeNull();
      expect(created.data).toHaveLength(4);
      const anchorPerInstallment = created.data?.find(
        (row) =>
          row.installment_group_id === groupPerInstallment &&
          row.installment_number === 1,
      );
      const anchorTotal = created.data?.find(
        (row) =>
          row.installment_group_id === groupTotal &&
          row.installment_number === 1,
      );
      const allTransactionIds = created.data?.map((row) => row.id) ?? [];
      if (!anchorPerInstallment || !anchorTotal)
        throw new Error("Installment anchors were not created");

      const readCardLiability = async () => {
        const balances = await listAccountBalances(testContext);
        return balances.find((account) => account.id === cardId)
          ?.currentLiability;
      };
      const readPaymentDetail = async (month: string) => {
        const overview = await listPaymentMethodOverview(month, testContext);
        return overview.find((account) => account.id === cardId);
      };
      const readMcpPaymentAccount = async () => {
        if (!mcpClient) throw new Error("MCP client is not connected");
        const response = await mcpClient.callTool({
          arguments: {},
          name: "list_payment_accounts",
        });
        expect(response.isError).not.toBe(true);
        const data = (
          response.structuredContent as {
            data: {
              items: Array<{ currentLiability: number | null; id: string }>;
            };
          }
        ).data;
        return data.items.find((account) => account.id === cardId)
          ?.currentLiability;
      };
      const mcpSafeToSpend = async (month: string) => {
        if (!mcpClient) throw new Error("MCP client is not connected");
        const response = await mcpClient.callTool({
          arguments: { month },
          name: "get_dashboard_summary",
        });
        expect(response.isError).not.toBe(true);
        return (
          response.structuredContent as {
            data: {
              safeToSpend: { regularSpent: number; spent: number };
              totalLiabilities: number;
            };
          }
        ).data;
      };

      mcpServer = createReadOnlyMcpServer({
        auth: createStaticMcpAuthProvider(testContext),
      });
      mcpClient = new Client({
        name: "installment-read-model-test",
        version: "1",
      });
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await mcpServer.connect(serverTransport);
      await mcpClient.connect(clientTransport);

      expect(await readCardLiability()).toBeCloseTo(0.04, 2);
      const activeDashboard = await getCatWalletDashboardData(
        nextMonth,
        testContext,
      );
      expect(activeDashboard.safeToSpend.spent).toBeCloseTo(0.02, 2);
      expect(
        (await readPaymentDetail(nextMonth))?.detail.totalAmount,
      ).toBeCloseTo(0.04, 2);
      expect(await readMcpPaymentAccount()).toBeCloseTo(0.04, 2);

      await completeInstallment(anchorPerInstallment.id, testContext);
      await completeInstallment(anchorTotal.id, testContext);
      await deleteTransaction(anchorPerInstallment.id, testContext);
      await deleteTransaction(anchorTotal.id, testContext);

      const deletedRows = await testClient
        .from("transactions")
        .select("id, deleted_at, installment_completed_at")
        .eq("user_id", testUser.id)
        .in("id", allTransactionIds);
      expect(deletedRows.error).toBeNull();
      expect(deletedRows.data).toHaveLength(4);
      expect(
        deletedRows.data?.filter((row) => row.deleted_at !== null),
      ).toHaveLength(2);
      expect(
        deletedRows.data?.every((row) => row.installment_completed_at !== null),
      ).toBe(true);

      const hiddenDashboard = await getCatWalletDashboardData(
        nextMonth,
        testContext,
      );
      const hiddenReport = await getMonthlyReport(
        testUser.id,
        nextMonth,
        testContext,
      );
      const hiddenPayments = await readPaymentDetail(nextMonth);
      const hiddenMcpDashboard = await mcpSafeToSpend(nextMonth);
      expect(await readCardLiability()).toBe(0);
      expect(hiddenDashboard).toMatchObject({
        nextDue: null,
        totalLiabilities: 0,
        netFunds: 0,
        safeToSpend: { regularSpent: 0, spent: 0, safeToSpend: 0 },
      });
      expect(hiddenReport.core.actualExpenses).toBe(0);
      expect(hiddenReport.core).toMatchObject({
        income: 0,
        longTermSavings: 0,
        netBalance: 0,
      });
      expect(hiddenReport.topExpenses).toEqual([]);
      expect(hiddenPayments?.detail).toMatchObject({
        totalAmount: 0,
        transactions: [],
      });
      expect(await readMcpPaymentAccount()).toBe(0);
      expect(hiddenMcpDashboard).toMatchObject({
        safeToSpend: { regularSpent: 0, spent: 0 },
        totalLiabilities: 0,
      });
      expect(
        await listTransactions({ month: nextMonth, userContext: testContext }),
      ).toEqual([]);

      const [julyReport, augustReport] = await Promise.all([
        getMonthlyReport(testUser.id, "2026-07", testContext),
        getMonthlyReport(testUser.id, "2026-08", testContext),
      ]);
      expect(julyReport.core.actualExpenses).toBeCloseTo(487.36, 2);
      expect(augustReport.core.actualExpenses).toBeCloseTo(1784.52, 2);

      const cumulativeBalance = await testClient.rpc("calculate_total_saved", {
        p_selected_month: "2026-10-01",
      });
      expect(cumulativeBalance.error).toBeNull();
      expect(Number(cumulativeBalance.data)).toBeCloseTo(-2271.88, 2);

      await restoreTransaction(anchorPerInstallment.id, testContext);
      const restoredRow = await testClient
        .from("transactions")
        .select("deleted_at")
        .eq("id", anchorPerInstallment.id)
        .eq("user_id", testUser.id)
        .single();
      expect(restoredRow.error).toBeNull();
      expect(restoredRow.data?.deleted_at).toBeNull();

      const restoredDashboard = await getCatWalletDashboardData(
        currentMonth,
        testContext,
      );
      const restoredReport = await getMonthlyReport(
        testUser.id,
        currentMonth,
        testContext,
      );
      expect(await readCardLiability()).toBeCloseTo(0.01, 2);
      expect(restoredDashboard.safeToSpend.spent).toBeCloseTo(0.01, 2);
      expect(restoredDashboard.totalLiabilities).toBeCloseTo(0.01, 2);
      expect(restoredReport.core.actualExpenses).toBeCloseTo(0.01, 2);
      expect(
        (await readPaymentDetail(currentMonth))?.detail.totalAmount,
      ).toBeCloseTo(0.01, 2);
      expect(await readMcpPaymentAccount()).toBeCloseTo(0.01, 2);
      expect((await mcpSafeToSpend(currentMonth)).totalLiabilities).toBeCloseTo(
        0.01,
        2,
      );

      await restoreTransaction(anchorPerInstallment.id, testContext);
      expect(await readCardLiability()).toBeCloseTo(0.01, 2);
      expect(
        (await getCatWalletDashboardData(currentMonth, testContext)).safeToSpend
          .spent,
      ).toBeCloseTo(0.01, 2);

      await deleteTransaction(anchorPerInstallment.id, testContext);
      await deleteTransaction(anchorPerInstallment.id, testContext);
      expect(await readCardLiability()).toBe(0);
      expect(
        (await getCatWalletDashboardData(currentMonth, testContext)).safeToSpend
          .spent,
      ).toBe(0);

      await restoreTransaction(anchorPerInstallment.id, testContext);
      expect(await readCardLiability()).toBeCloseTo(0.01, 2);
      expect(
        (await getCatWalletDashboardData(currentMonth, testContext)).safeToSpend
          .spent,
      ).toBeCloseTo(0.01, 2);
    } finally {
      await mcpClient?.close();
      await mcpServer?.close();
      await testClient.auth.signOut();
      await admin.auth.admin.deleteUser(testUser.id);
    }
  });
});

describe("local CatWallet cooling items", () => {
  it("supports dynamic release, purchase linking, abandonment, RLS, and no balance mutation", async () => {
    const beforeCooling = await getCatWalletDashboardData("2026-09", contextA);
    const expenseCategory = await defaultCategory(clientA, "needs");
    const paymentMethod = await defaultPaymentMethod(clientA);

    const cooling = await createCoolingItem(
      {
        amountCents: 80_000,
        coolingDays: 7,
        name: "本地测试冷静打印机",
      },
      contextA,
    );
    const afterCoolingOnly = await getCatWalletDashboardData(
      "2026-09",
      contextA,
    );
    expect(afterCoolingOnly.safeToSpend).toEqual(beforeCooling.safeToSpend);
    expect(afterCoolingOnly.safeToSpend.spent).toBe(
      beforeCooling.safeToSpend.spent,
    );
    expect(
      (await listCoolingItems(contextA)).find((item) => item.id === cooling.id),
    ).toMatchObject({ status: "cooling", amountCents: 80_000 });

    const releasedAt = await clientA
      .from("cooling_items")
      .update({ added_at: "2026-09-01T00:00:00Z" })
      .eq("id", cooling.id)
      .select("id")
      .single();
    expect(releasedAt.error).toBeNull();
    expect(
      (await listCoolingItems(contextA)).find((item) => item.id === cooling.id)
        ?.status,
    ).toBe("ready");

    const purchaseCandidate = await createCoolingItem(
      {
        amountCents: 80_000,
        coolingDays: 7,
        name: "本地测试购买关联",
      },
      contextA,
    );
    const transaction = await clientA
      .from("transactions")
      .insert({
        amount: 800,
        category_id: expenseCategory.id,
        date: "2026-09-17",
        description: encryptDescription("cooling purchase integration"),
        kind: "expense",
        payment_method_id: paymentMethod.id,
      })
      .select("id")
      .single();
    expect(transaction.error).toBeNull();
    if (!transaction.data)
      throw new Error("Purchase transaction was not created");

    const purchased = await markCoolingItemPurchased(
      purchaseCandidate.id,
      transaction.data.id,
      contextA,
    );
    const replayed = await markCoolingItemPurchased(
      purchaseCandidate.id,
      transaction.data.id,
      contextA,
    );
    expect(purchased).toMatchObject({
      purchasedTransactionId: transaction.data.id,
      status: "purchased",
    });
    expect(replayed).toMatchObject({
      purchasedTransactionId: transaction.data.id,
      status: "purchased",
    });

    const abandonedCandidate = await createCoolingItem(
      { amountCents: 50_000, name: "本地测试放弃购买" },
      contextA,
    );
    const abandoned = await abandonCoolingItem(abandonedCandidate.id, contextA);
    expect(abandoned).toMatchObject({ status: "abandoned" });
    expect(abandoned.purchasedTransactionId).toBeNull();

    expect(
      (await listCoolingItems(makeContext(clientB, userB))).some(
        (item) => item.id === cooling.id || item.id === purchaseCandidate.id,
      ),
    ).toBe(false);
    await expect(
      abandonCoolingItem(cooling.id, makeContext(clientB, userB)),
    ).rejects.toThrow();
  });
});

describe("local CatWallet fun money transactions", () => {
  it("derives the allowance from marked expense rows across edits, deletes, and months", async () => {
    const expenseCategory = await defaultCategory(clientA, "needs");
    const incomeCategory = await defaultCategory(clientA, "income");
    const paymentMethod = await defaultPaymentMethod(clientA);

    await setFunMoneyBudget({ amount: 300, month: "2026-09" }, contextA);

    const markedExpense = await clientA
      .from("transactions")
      .insert({
        amount: 50,
        category_id: expenseCategory.id,
        counts_toward_fun_money: true,
        date: "2026-09-20",
        description: encryptDescription("fun money marked expense"),
        kind: "expense",
        payment_method_id: paymentMethod.id,
      })
      .select("id")
      .single();
    expect(markedExpense.error).toBeNull();
    if (!markedExpense.data) throw new Error("Marked expense was not created");

    const unmarkedExpense = await clientA.from("transactions").insert({
      amount: 50,
      category_id: expenseCategory.id,
      date: "2026-09-21",
      description: encryptDescription("ordinary expense"),
      kind: "expense",
      payment_method_id: paymentMethod.id,
    });
    expect(unmarkedExpense.error).toBeNull();

    const income = await clientA.from("transactions").insert({
      amount: 50,
      category_id: incomeCategory.id,
      counts_toward_fun_money: true,
      date: "2026-09-22",
      description: encryptDescription("income must not count"),
      kind: "income",
      payment_method_id: paymentMethod.id,
    });
    expect(income.error).not.toBeNull();

    const initial = await getFunMoneyOverview("2026-09", contextA);
    expect(initial).toMatchObject({ remaining: 250, spent: 50 });

    const edited = await clientA
      .from("transactions")
      .update({ amount: 30 })
      .eq("id", markedExpense.data.id)
      .select("id")
      .single();
    expect(edited.error).toBeNull();
    expect(await getFunMoneyOverview("2026-09", contextA)).toMatchObject({
      remaining: 270,
      spent: 30,
    });

    const moved = await clientA
      .from("transactions")
      .update({ date: "2026-10-01" })
      .eq("id", markedExpense.data.id)
      .select("id")
      .single();
    expect(moved.error).toBeNull();
    expect(await getFunMoneyOverview("2026-09", contextA)).toMatchObject({
      remaining: 300,
      spent: 0,
    });
    expect(await getFunMoneyOverview("2026-10", contextA)).toMatchObject({
      spent: 30,
    });

    const unmarked = await clientA
      .from("transactions")
      .update({ counts_toward_fun_money: false })
      .eq("id", markedExpense.data.id)
      .select("id")
      .single();
    expect(unmarked.error).toBeNull();
    expect(await getFunMoneyOverview("2026-10", contextA)).toMatchObject({
      spent: 0,
    });

    const restored = await clientA
      .from("transactions")
      .update({ counts_toward_fun_money: true, date: "2026-09-23" })
      .eq("id", markedExpense.data.id)
      .select("id")
      .single();
    expect(restored.error).toBeNull();
    const deleted = await clientA
      .from("transactions")
      .delete()
      .eq("id", markedExpense.data.id)
      .select("id")
      .single();
    expect(deleted.error).toBeNull();
    expect(await getFunMoneyOverview("2026-09", contextA)).toMatchObject({
      spent: 0,
    });

    await setFunMoneyBudget({ amount: 100, month: "2026-09" }, contextA);
    const overBudget = await clientA
      .from("transactions")
      .insert({
        amount: 150,
        category_id: expenseCategory.id,
        counts_toward_fun_money: true,
        date: "2026-09-24",
        description: encryptDescription("fun money over budget"),
        kind: "expense",
        payment_method_id: paymentMethod.id,
      })
      .select("id")
      .single();
    expect(overBudget.error).toBeNull();
    if (!overBudget.data)
      throw new Error("Over-budget expense was not created");

    const over = await getFunMoneyOverview("2026-09", contextA);
    expect(over).toMatchObject({
      isOverBudget: true,
      overAmount: 50,
      remaining: -50,
      spent: 150,
    });

    const dashboard = await getCatWalletDashboardData("2026-09", contextA);
    const expenseRows = await clientA
      .from("transactions")
      .select("amount")
      .eq("kind", "expense")
      .gte("date", "2026-09-01")
      .lt("date", "2026-10-01")
      .is("deleted_at", null);
    expect(expenseRows.error).toBeNull();
    const actualSpent = (expenseRows.data ?? []).reduce(
      (sum, row) => sum + Number(row.amount),
      0,
    );
    expect(dashboard.safeToSpend.spent).toBe(actualSpent);

    const cleanup = await clientA
      .from("transactions")
      .delete()
      .eq("id", overBudget.data.id);
    expect(cleanup.error).toBeNull();
  });
});

describe("local CatWallet monthly report", () => {
  it("aggregates current finance services and keeps the report user-scoped", async () => {
    const reportEmail = `cat-report-${randomUUID()}@example.test`;
    const reportClient = createUserClient();
    const reportUser = await signUpAndSignIn(reportClient, reportEmail);
    const reportContext = makeContext(reportClient, reportUser);
    let transactionIds: string[] = [];
    let coolingItemIds: string[] = [];
    let commitmentId: string | null = null;
    let fundId: string | null = null;

    try {
      const expenseCategory = await defaultCategory(reportClient, "needs");
      const incomeCategory = await defaultCategory(reportClient, "income");
      const savingsCategory = await reportClient
        .from("categories")
        .select("id")
        .eq("group_type", "savings")
        .eq("is_default", true)
        .limit(1)
        .single();
      expect(savingsCategory.error).toBeNull();
      const paymentMethod = await defaultPaymentMethod(reportClient);
      const commitment = await createFixedCommitment(
        {
          amount: 500,
          cadence: "monthly",
          name: "Monthly report commitment",
          startDate: "2026-09-01",
        },
        reportContext,
      );
      commitmentId = commitment.id;
      const fund = await createSinkingFund(
        {
          currentAmount: 350,
          emoji: "🧪",
          monthlyTarget: 100,
          name: "Monthly report fund",
          targetAmount: 1000,
        },
        reportContext,
      );
      fundId = fund.id;
      await setFunMoneyBudget({ amount: 300, month: "2026-09" }, reportContext);

      const transactions = await reportClient
        .from("transactions")
        .insert([
          {
            amount: 2000,
            category_id: incomeCategory.id,
            counts_toward_fun_money: false,
            date: "2026-09-01",
            description: encryptDescription("monthly report income"),
            kind: "income",
            payment_method_id: paymentMethod.id,
          },
          {
            amount: 500,
            category_id: expenseCategory.id,
            counts_toward_fun_money: false,
            date: "2026-09-02",
            description: encryptDescription("monthly report fixed"),
            fixed_commitment_id: commitment.id,
            kind: "expense",
            payment_method_id: paymentMethod.id,
          },
          {
            amount: 80,
            category_id: expenseCategory.id,
            counts_toward_fun_money: true,
            date: "2026-09-03",
            description: encryptDescription("monthly report fun"),
            kind: "expense",
            payment_method_id: paymentMethod.id,
          },
          {
            amount: 200,
            category_id: savingsCategory.data?.id,
            counts_toward_fun_money: false,
            date: "2026-09-04",
            description: encryptDescription("monthly report savings"),
            kind: "saving",
            payment_method_id: paymentMethod.id,
          },
          {
            amount: 800,
            category_id: expenseCategory.id,
            counts_toward_fun_money: false,
            date: "2026-09-05",
            description: encryptDescription("monthly report purchase"),
            kind: "expense",
            payment_method_id: paymentMethod.id,
          },
        ])
        .select("id");
      expect(transactions.error).toBeNull();
      if (!transactions.data)
        throw new Error("Monthly report transactions missing");
      transactionIds = transactions.data.map((row) => row.id);

      const coolingItems = await reportClient
        .from("cooling_items")
        .insert([
          {
            added_at: "2026-09-06T00:00:00.000Z",
            amount_cents: 80_000,
            cooling_days: 7,
            name: "Monthly report purchase",
            purchased_transaction_id: transactions.data.at(-1)!.id,
            status: "purchased",
            updated_at: "2026-09-07T00:00:00.000Z",
          },
          {
            added_at: "2026-09-08T00:00:00.000Z",
            amount_cents: 50_000,
            cooling_days: 7,
            name: "Monthly report abandoned",
            status: "abandoned",
            updated_at: "2026-09-09T00:00:00.000Z",
          },
        ])
        .select("id");
      expect(coolingItems.error).toBeNull();
      if (!coolingItems.data)
        throw new Error("Monthly report cooling items missing");
      coolingItemIds = coolingItems.data.map((row) => row.id);

      const report = await getMonthlyReport(
        reportUser.id,
        "2026-09",
        reportContext,
      );
      expect(report.core).toMatchObject({
        actualExpenses: 1380,
        income: 2000,
        longTermSavings: 200,
        sinkingFundReserve: 100,
      });
      expect(report.specialSpending).toMatchObject({
        fixedCommitments: 500,
        funMoney: 80,
      });
      expect(report.cooling).toEqual({
        abandonedAmount: 500,
        abandonedCount: 1,
        addedCount: 2,
        purchasedCount: 1,
      });
      expect(report.topExpenses[0]).toMatchObject({
        amount: 800,
        description: "monthly report purchase",
      });

      const otherUserReport = await getMonthlyReport(
        userB.id,
        "2026-09",
        makeContext(clientB, userB),
      );
      expect(otherUserReport.topExpenses).toEqual([]);
    } finally {
      if (transactionIds.length > 0) {
        await reportClient
          .from("transactions")
          .delete()
          .in("id", transactionIds);
      }
      if (coolingItemIds.length > 0) {
        await reportClient
          .from("cooling_items")
          .delete()
          .in("id", coolingItemIds);
      }
      if (commitmentId)
        await deleteFixedCommitment(commitmentId, reportContext);
      if (fundId) await deleteSinkingFund(fundId, reportContext);
      await reportClient.auth.signOut();
      await removeUserByEmail(reportEmail);
    }
  });
});
