import "server-only";

import type { InstallmentAmountMode } from "@/lib/data";
import {
  centsToMoney,
  listAccountBalances,
  parseMoneyToCents,
  summarizeAccountFunds,
  type AccountBalance,
} from "@/lib/finance/account-balances";

import {
  decryptField,
  encryptDescription,
  encryptField,
} from "@/lib/crypto/field-encryption";
import {
  getIncomeAmount,
  getPersonalSpendingAmount,
} from "@/lib/finance/transaction-semantics";
import {
  groupTransactionsByInstallmentGroup,
  isRetiredFutureInstallmentProjection,
} from "@/lib/finance/installments";
import {
  calculateSafeToSpend,
  getFixedCommitmentsForMonth,
  toMonthlyAmount,
  type SafeToSpendCadence,
} from "@/lib/finance/safe-to-spend";
import {
  getUserContext,
  listTransactions,
  type AuthenticatedUserContext,
} from "@/lib/finance/transactions";
import { buildInstallmentPlan } from "@/lib/finance/installment-plan";
import {
  calculateFunMoneyStatus,
  sumFunMoneyTransactions,
  type FunMoneyStatus,
} from "@/lib/finance/fun-money";

export type FixedCommitment = {
  archivedAt?: string;
  amount: number;
  cadence: SafeToSpendCadence;
  categoryId: string | null;
  categoryName: string | null;
  customIntervalMonths: number | null;
  endDate: string | null;
  id: string;
  includeInSafeToSpend: boolean;
  isEnabled: boolean;
  name: string;
  paymentMethodId: string | null;
  paymentMethodName: string | null;
  startDate: string;
};

export type SinkingFund = {
  archivedAt?: string;
  currentAmount: number;
  emoji: string;
  expectedUseDate: string | null;
  id: string;
  isEnabled: boolean;
  monthlyTarget: number;
  name: string;
  notes: string | null;
  targetAmount: number | null;
};

export type InstallmentRetirementAllocation = {
  id: string;
  installmentGroupId: string;
  isEnabled: boolean;
  monthlyAmount: number;
  notes: string | null;
  startsMonth: string;
  targetId: string | null;
  targetType: "category" | "sinking_fund" | "savings";
};

export type FixedCommitmentInput = {
  amount: number;
  cadence: SafeToSpendCadence;
  categoryId?: string | null;
  customIntervalMonths?: number | null;
  endDate?: string | null;
  includeInSafeToSpend?: boolean;
  isEnabled?: boolean;
  id?: string;
  name: string;
  paymentMethodId?: string | null;
  startDate: string;
};

export type SinkingFundInput = {
  currentAmount?: number;
  emoji: string;
  expectedUseDate?: string | null;
  isEnabled?: boolean;
  id?: string;
  monthlyTarget: number;
  name: string;
  notes?: string | null;
  targetAmount?: number | null;
};

export type UpdateSinkingFundInput = Omit<SinkingFundInput, "currentAmount"> & {
  id: string;
};

export type InstallmentRetirementAllocationInput = {
  installmentGroupId: string;
  isEnabled?: boolean;
  monthlyAmount: number;
  notes?: string | null;
  startsMonth: string;
  targetId?: string | null;
  targetType: InstallmentRetirementAllocation["targetType"];
};

export type SaveInstallmentRetirementInput = {
  installmentGroupId: string;
  startsMonth: string;
  allocations: Pick<
    InstallmentRetirementAllocationInput,
    "monthlyAmount" | "targetType" | "targetId"
  >[];
};

export type CatWalletDashboardData = {
  accountBalances: AccountBalance[];
  fixedCommitments: Array<
    FixedCommitment & {
      monthlyAmount: number;
      paidAmount: number;
      remainingAmount: number;
    }
  >;
  month: string;
  monthlyAmountConfigured: boolean;
  nextDue?: {
    amount: number;
    date: string;
    descriptionKey: string;
  } | null;
  refreshedAt?: string;
  safeToSpend: ReturnType<typeof calculateSafeToSpend>;
  sinkingFunds: SinkingFund[];
  totalAssets: number;
  totalLiabilities: number;
  netFunds: number;
};

export type FunMoneyOverview = FunMoneyStatus & {
  month: string;
};

export type FunMoneyBudgetInput = {
  amount: number;
  month: string;
};

export type InstallmentOverviewItem = {
  archivedAt?: string;
  amountMode: InstallmentAmountMode;
  currentInstallment: number;
  monthlyAmount: number;
  retirementStartsMonth: string;
  endDate: string;
  groupId: string;
  name: string;
  paidAmount: number;
  paidInstallments: number;
  remainingAmount: number;
  remainingInstallments: number;
  totalAmount: number;
  totalInstallments: number;
  allocations: InstallmentRetirementAllocation[];
  retired: boolean;
};

type FixedCommitmentRow = {
  amount: number | string;
  cadence: SafeToSpendCadence;
  categories: { name: string } | null;
  category_id: string | null;
  custom_interval_months: number | string | null;
  deleted_at?: string | null;
  end_date: string | null;
  id: string;
  include_in_safe_to_spend: boolean;
  is_enabled: boolean;
  name: string;
  payment_method_id: string | null;
  payment_methods: { name: string } | null;
  start_date: string;
};

type SinkingFundRow = {
  current_amount: number | string;
  deleted_at?: string | null;
  emoji: string;
  expected_use_date: string | null;
  id: string;
  is_enabled: boolean;
  monthly_target: number | string;
  name: string;
  notes: string | null;
  target_amount: number | string | null;
};

type AllocationRow = {
  id: string;
  installment_group_id: string;
  is_enabled: boolean;
  monthly_amount: number | string;
  notes: string | null;
  starts_month: string;
  target_id: string | null;
  target_type: InstallmentRetirementAllocation["targetType"];
};

function assertPositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
}

function assertNonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} cannot be negative.`);
  }
}

function assertDate(value: string | null | undefined, label: string) {
  if (value == null) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

function assertMonth(value: string, label: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

function normalizeName(value: string) {
  const name = value.trim();
  if (!name || name.length > 160) throw new Error("Name is invalid.");
  return name;
}

async function assertOwnedReference(
  ctx: AuthenticatedUserContext,
  table: "categories" | "payment_methods",
  id: string | null | undefined,
  label: string,
) {
  if (!id) return;
  const { data, error } = await ctx.supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`Unable to validate ${label}: ${error.message}`);
  if (!data) throw new Error(`${label} is invalid.`);
}

function normalizeCadence(input: FixedCommitmentInput) {
  if (!["monthly", "yearly", "custom"].includes(input.cadence)) {
    throw new Error("Cadence is invalid.");
  }

  if (input.cadence === "custom") {
    const interval = Number(input.customIntervalMonths);
    if (!Number.isInteger(interval) || interval < 1 || interval > 120) {
      throw new Error("Custom interval is invalid.");
    }
    return interval;
  }

  return null;
}

function mapFixedCommitment(row: FixedCommitmentRow): FixedCommitment {
  return {
    ...(row.deleted_at ? { archivedAt: row.deleted_at } : {}),
    amount: Number(row.amount),
    cadence: row.cadence,
    categoryId: row.category_id,
    categoryName: row.categories?.name ?? null,
    customIntervalMonths:
      row.custom_interval_months == null
        ? null
        : Number(row.custom_interval_months),
    endDate: row.end_date,
    id: row.id,
    includeInSafeToSpend: row.include_in_safe_to_spend,
    isEnabled: row.is_enabled,
    name: row.name,
    paymentMethodId: row.payment_method_id,
    paymentMethodName: row.payment_methods?.name ?? null,
    startDate: row.start_date,
  };
}

function mapSinkingFund(row: SinkingFundRow): SinkingFund {
  return {
    ...(row.deleted_at ? { archivedAt: row.deleted_at } : {}),
    currentAmount: Number(row.current_amount),
    emoji: row.emoji,
    expectedUseDate: row.expected_use_date,
    id: row.id,
    isEnabled: row.is_enabled,
    monthlyTarget: Number(row.monthly_target),
    name: row.name,
    notes: row.notes,
    targetAmount: row.target_amount == null ? null : Number(row.target_amount),
  };
}

function mapAllocation(row: AllocationRow): InstallmentRetirementAllocation {
  return {
    id: row.id,
    installmentGroupId: row.installment_group_id,
    isEnabled: row.is_enabled,
    monthlyAmount: Number(row.monthly_amount),
    notes: row.notes,
    startsMonth: row.starts_month.slice(0, 7),
    targetId: row.target_id,
    targetType: row.target_type,
  };
}

async function resolveContext(
  userContext?: AuthenticatedUserContext,
): Promise<AuthenticatedUserContext> {
  return userContext ?? (await getUserContext());
}

const fixedCommitmentSelect =
  "id, name, amount, cadence, custom_interval_months, start_date, end_date, payment_method_id, category_id, include_in_safe_to_spend, is_enabled, deleted_at, categories(name), payment_methods(name)";

export async function listFixedCommitments(
  userContext?: AuthenticatedUserContext,
  options?: { includeArchived?: boolean },
): Promise<FixedCommitment[]> {
  const ctx = await resolveContext(userContext);
  let query = ctx.supabase
    .from("fixed_commitments")
    .select(fixedCommitmentSelect)
    .eq("user_id", ctx.userId);
  if (!options?.includeArchived) query = query.is("deleted_at", null);
  const { data, error } = await query
    .order("start_date", { ascending: true })
    .order("name", { ascending: true });

  if (error)
    throw new Error(`Unable to load fixed commitments: ${error.message}`);
  return ((data ?? []) as unknown as FixedCommitmentRow[]).map(
    mapFixedCommitment,
  );
}

export async function createFixedCommitment(
  input: FixedCommitmentInput,
  userContext?: AuthenticatedUserContext,
) {
  const ctx = await resolveContext(userContext);
  const customIntervalMonths = normalizeCadence(input);
  const name = normalizeName(input.name);
  assertPositive(input.amount, "Amount");
  assertDate(input.startDate, "Start date");
  assertDate(input.endDate, "End date");
  await Promise.all([
    assertOwnedReference(ctx, "categories", input.categoryId, "Category"),
    assertOwnedReference(
      ctx,
      "payment_methods",
      input.paymentMethodId,
      "Payment method",
    ),
  ]);

  const { data, error } = await ctx.supabase
    .from("fixed_commitments")
    .insert({
      ...(input.id ? { id: input.id } : {}),
      amount: input.amount,
      cadence: input.cadence,
      category_id: input.categoryId ?? null,
      custom_interval_months: customIntervalMonths,
      end_date: input.endDate ?? null,
      include_in_safe_to_spend: input.includeInSafeToSpend ?? true,
      is_enabled: input.isEnabled ?? true,
      name,
      payment_method_id: input.paymentMethodId ?? null,
      start_date: input.startDate,
      user_id: ctx.userId,
    })
    .select(fixedCommitmentSelect)
    .single();

  if (error)
    throw new Error(`Unable to create fixed commitment: ${error.message}`);
  return mapFixedCommitment(data as unknown as FixedCommitmentRow);
}

export async function updateFixedCommitment(
  input: FixedCommitmentInput & { id: string },
  userContext?: AuthenticatedUserContext,
) {
  const ctx = await resolveContext(userContext);
  const customIntervalMonths = normalizeCadence(input);
  const name = normalizeName(input.name);
  assertPositive(input.amount, "Amount");
  assertDate(input.startDate, "Start date");
  assertDate(input.endDate, "End date");
  await Promise.all([
    assertOwnedReference(ctx, "categories", input.categoryId, "Category"),
    assertOwnedReference(
      ctx,
      "payment_methods",
      input.paymentMethodId,
      "Payment method",
    ),
  ]);

  const { data, error } = await ctx.supabase
    .from("fixed_commitments")
    .update({
      amount: input.amount,
      cadence: input.cadence,
      category_id: input.categoryId ?? null,
      custom_interval_months: customIntervalMonths,
      end_date: input.endDate ?? null,
      include_in_safe_to_spend: input.includeInSafeToSpend ?? true,
      is_enabled: input.isEnabled ?? true,
      name,
      payment_method_id: input.paymentMethodId ?? null,
      start_date: input.startDate,
    })
    .eq("id", input.id)
    .eq("user_id", ctx.userId)
    .select(fixedCommitmentSelect)
    .single();

  if (error)
    throw new Error(`Unable to update fixed commitment: ${error.message}`);
  return mapFixedCommitment(data as unknown as FixedCommitmentRow);
}

export async function deleteFixedCommitment(
  id: string,
  userContext?: AuthenticatedUserContext,
) {
  const ctx = await resolveContext(userContext);
  const { error } = await ctx.supabase
    .from("fixed_commitments")
    .update({ deleted_at: new Date().toISOString(), is_enabled: false })
    .eq("id", id)
    .eq("user_id", ctx.userId);

  if (error)
    throw new Error(`Unable to delete fixed commitment: ${error.message}`);
}

export async function recordFixedCommitmentPayment(
  input: {
    amount: number;
    commitmentId: string;
    date: string;
    description: string;
    id?: string;
    notes?: string | null;
  },
  userContext?: AuthenticatedUserContext,
) {
  const ctx = await resolveContext(userContext);
  assertPositive(input.amount, "Amount");
  assertDate(input.date, "Date");
  const description = normalizeName(input.description);
  const { data: commitment, error: commitmentError } = await ctx.supabase
    .from("fixed_commitments")
    .select("id, category_id, payment_method_id")
    .eq("id", input.commitmentId)
    .eq("user_id", ctx.userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (commitmentError)
    throw new Error(
      `Unable to load fixed commitment: ${commitmentError.message}`,
    );
  if (!commitment) throw new Error("Fixed commitment is invalid.");

  const { error } = await ctx.supabase.from("transactions").insert({
    ...(input.id ? { id: input.id } : {}),
    amount: input.amount,
    category_id: commitment.category_id,
    date: input.date,
    description: encryptDescription(description),
    fixed_commitment_id: input.commitmentId,
    kind: "expense",
    notes: encryptField(input.notes?.trim() || null),
    payment_method_id: commitment.payment_method_id,
    user_id: ctx.userId,
  });

  if (error)
    throw new Error(
      `Unable to record fixed commitment payment: ${error.message}`,
    );
}

export async function listSinkingFunds(
  userContext?: AuthenticatedUserContext,
  options?: { includeArchived?: boolean },
): Promise<SinkingFund[]> {
  const ctx = await resolveContext(userContext);
  let query = ctx.supabase
    .from("sinking_funds")
    .select(
      "id, name, emoji, current_amount, monthly_target, target_amount, expected_use_date, is_enabled, notes, deleted_at",
    )
    .eq("user_id", ctx.userId);
  if (!options?.includeArchived) query = query.is("deleted_at", null);
  const { data, error } = await query
    .order("is_enabled", { ascending: false })
    .order("expected_use_date", { ascending: true, nullsFirst: false });

  if (error) throw new Error(`Unable to load sinking funds: ${error.message}`);
  return ((data ?? []) as unknown as SinkingFundRow[]).map(mapSinkingFund);
}

export async function createSinkingFund(
  input: SinkingFundInput,
  userContext?: AuthenticatedUserContext,
) {
  const ctx = await resolveContext(userContext);
  const name = normalizeName(input.name);
  assertNonNegative(input.currentAmount ?? 0, "Current amount");
  assertNonNegative(input.monthlyTarget, "Monthly target");
  if (input.targetAmount != null)
    assertPositive(input.targetAmount, "Target amount");
  assertDate(input.expectedUseDate, "Expected use date");

  const { data, error } = await ctx.supabase
    .from("sinking_funds")
    .insert({
      ...(input.id ? { id: input.id } : {}),
      current_amount: input.currentAmount ?? 0,
      emoji: input.emoji.trim() || "🛟",
      expected_use_date: input.expectedUseDate ?? null,
      is_enabled: input.isEnabled ?? true,
      monthly_target: input.monthlyTarget,
      name,
      notes: input.notes?.trim() || null,
      target_amount: input.targetAmount ?? null,
      user_id: ctx.userId,
    })
    .select(
      "id, name, emoji, current_amount, monthly_target, target_amount, expected_use_date, is_enabled, notes",
    )
    .single();

  if (error) throw new Error(`Unable to create sinking fund: ${error.message}`);
  return mapSinkingFund(data as unknown as SinkingFundRow);
}

export async function updateSinkingFund(
  input: UpdateSinkingFundInput,
  userContext?: AuthenticatedUserContext,
) {
  const ctx = await resolveContext(userContext);
  const name = normalizeName(input.name);
  assertNonNegative(input.monthlyTarget, "Monthly target");
  if (input.targetAmount != null)
    assertPositive(input.targetAmount, "Target amount");
  assertDate(input.expectedUseDate, "Expected use date");

  const { data, error } = await ctx.supabase
    .from("sinking_funds")
    .update({
      emoji: input.emoji.trim() || "🛟",
      expected_use_date: input.expectedUseDate ?? null,
      is_enabled: input.isEnabled ?? true,
      monthly_target: input.monthlyTarget,
      name,
      notes: input.notes?.trim() || null,
      target_amount: input.targetAmount ?? null,
    })
    .eq("id", input.id)
    .eq("user_id", ctx.userId)
    .select(
      "id, name, emoji, current_amount, monthly_target, target_amount, expected_use_date, is_enabled, notes",
    )
    .single();

  if (error) throw new Error(`Unable to update sinking fund: ${error.message}`);
  return mapSinkingFund(data as unknown as SinkingFundRow);
}

export async function deleteSinkingFund(
  id: string,
  userContext?: AuthenticatedUserContext,
) {
  const ctx = await resolveContext(userContext);
  const { error } = await ctx.supabase
    .from("sinking_funds")
    .update({ deleted_at: new Date().toISOString(), is_enabled: false })
    .eq("id", id)
    .eq("user_id", ctx.userId);

  if (error) throw new Error(`Unable to delete sinking fund: ${error.message}`);
}

export async function recordSinkingFundEntry(
  input: {
    amount: number;
    entryType: "contribution" | "withdrawal" | "adjustment";
    idempotencyKey: string;
    note?: string | null;
    sinkingFundId: string;
  },
  userContext?: AuthenticatedUserContext,
) {
  const ctx = await resolveContext(userContext);
  const { data, error } = await ctx.supabase.rpc("record_sinking_fund_entry", {
    p_amount: input.amount,
    p_entry_type: input.entryType,
    p_idempotency_key: input.idempotencyKey,
    p_note: input.note?.trim() || null,
    p_sinking_fund_id: input.sinkingFundId,
  });
  if (error)
    throw new Error(`Unable to record sinking fund entry: ${error.message}`);
  return Number(data);
}

export async function recordGoalFundEntry(
  input: {
    amount: number;
    entryType: "contribution" | "withdrawal" | "adjustment";
    goalId: string;
    idempotencyKey: string;
    note?: string | null;
  },
  userContext?: AuthenticatedUserContext,
) {
  const ctx = await resolveContext(userContext);
  const { data, error } = await ctx.supabase.rpc("record_goal_fund_entry", {
    p_amount: input.amount,
    p_entry_type: input.entryType,
    p_goal_id: input.goalId,
    p_idempotency_key: input.idempotencyKey,
    p_note: input.note?.trim() || null,
  });
  if (error)
    throw new Error(`Unable to record goal fund entry: ${error.message}`);
  return Number(data);
}

export async function listInstallmentRetirementAllocations(
  groupId?: string,
  userContext?: AuthenticatedUserContext,
) {
  const ctx = await resolveContext(userContext);
  let query = ctx.supabase
    .from("installment_retirement_allocations")
    .select(
      "id, installment_group_id, target_type, target_id, monthly_amount, starts_month, is_enabled, notes",
    )
    .eq("user_id", ctx.userId);

  if (groupId) query = query.eq("installment_group_id", groupId);
  const { data, error } = await query.order("starts_month", {
    ascending: true,
  });
  if (error)
    throw new Error(`Unable to load installment allocations: ${error.message}`);
  return ((data ?? []) as unknown as AllocationRow[]).map(mapAllocation);
}

export async function saveInstallmentRetirementAllocations(
  input: SaveInstallmentRetirementInput,
  userContext?: AuthenticatedUserContext,
) {
  const ctx = await resolveContext(userContext);
  assertMonth(input.startsMonth, "Starts month");
  const { data, error } = await ctx.supabase.rpc(
    "save_installment_retirement_allocations",
    {
      p_group_id: input.installmentGroupId,
      p_starts_month: `${input.startsMonth}-01`,
      p_allocations: input.allocations.map((allocation) => ({
        monthly_amount: allocation.monthlyAmount,
        target_type: allocation.targetType,
        target_id: allocation.targetId ?? null,
      })),
    },
  );
  if (error) throw new Error("Unable to save retirement destinations");
  return ((data ?? []) as unknown as AllocationRow[]).map(mapAllocation);
}

export async function upsertInstallmentRetirementAllocation(
  input: InstallmentRetirementAllocationInput,
  userContext?: AuthenticatedUserContext,
) {
  const ctx = await resolveContext(userContext);
  assertPositive(input.monthlyAmount, "Monthly amount");
  assertMonth(input.startsMonth, "Starts month");
  if (input.targetType !== "savings" && !input.targetId) {
    throw new Error("Allocation target is required.");
  }
  if (input.targetType === "savings" && input.targetId) {
    throw new Error("Savings allocation cannot have a target id.");
  }

  const payload = {
    installment_group_id: input.installmentGroupId,
    is_enabled: input.isEnabled ?? true,
    monthly_amount: input.monthlyAmount,
    notes: input.notes?.trim() || null,
    starts_month: `${input.startsMonth}-01`,
    target_id: input.targetId ?? null,
    target_type: input.targetType,
    user_id: ctx.userId,
  };
  let existingQuery = ctx.supabase
    .from("installment_retirement_allocations")
    .select("id")
    .eq("user_id", ctx.userId)
    .eq("installment_group_id", input.installmentGroupId)
    .eq("target_type", input.targetType);
  existingQuery =
    input.targetType === "savings"
      ? existingQuery.is("target_id", null)
      : existingQuery.eq("target_id", input.targetId ?? "");

  const { data: existing, error: existingError } =
    await existingQuery.maybeSingle();
  if (existingError) {
    throw new Error(
      `Unable to load installment allocation: ${existingError.message}`,
    );
  }

  const allocationQuery = existing
    ? ctx.supabase
        .from("installment_retirement_allocations")
        .update(payload)
        .eq("id", existing.id)
    : ctx.supabase.from("installment_retirement_allocations").insert(payload);
  const { data, error } = await allocationQuery
    .select(
      "id, installment_group_id, target_type, target_id, monthly_amount, starts_month, is_enabled, notes",
    )
    .single();

  if (error)
    throw new Error(`Unable to save installment allocation: ${error.message}`);
  return mapAllocation(data as unknown as AllocationRow);
}

export async function getCatWalletDashboardData(
  month: string,
  userContext?: AuthenticatedUserContext,
): Promise<CatWalletDashboardData> {
  const ctx = await resolveContext(userContext);
  assertMonth(month, "Month");
  const [
    accountBalances,
    commitments,
    sinkingFunds,
    transactionResult,
    budgetResult,
    invoiceTransactions,
  ] = await Promise.all([
    listAccountBalances(ctx),
    listFixedCommitments(ctx),
    listSinkingFunds(ctx),
    ctx.supabase
      .from("transactions")
      .select(
        "id, amount, kind, fixed_commitment_id, date, entry_kind, related_transaction_id, notes, installment_group_id, installment_number, installment_total, installment_completed_at",
      )
      .eq("user_id", ctx.userId)
      .gte("date", `${month}-01`)
      .lt("date", `${nextMonth(month)}-01`)
      .is("deleted_at", null),
    ctx.supabase
      .from("monthly_budgets")
      .select("savings_limit, income")
      .eq("user_id", ctx.userId)
      .eq("month", `${month}-01`)
      .maybeSingle(),
    listTransactions({
      includeCreditCardInvoices: true,
      includeFuture: true,
      month,
      useFinancialMonth: false,
      userContext: ctx,
    }),
  ]);

  if (transactionResult.error) {
    throw new Error(
      `Unable to load CatWallet transactions: ${transactionResult.error.message}`,
    );
  }
  if (budgetResult.error && budgetResult.error.code !== "PGRST116") {
    throw new Error(
      `Unable to load monthly savings target: ${budgetResult.error.message}`,
    );
  }

  const transactions = (transactionResult.data ?? []) as Array<{
    amount: number | string;
    date: string;
    fixed_commitment_id: string | null;
    id: string;
    kind: "income" | "expense" | "saving";
    entry_kind?:
      "purchase" | "repayment" | "refund" | "reimbursement" | "transfer";
    installment_completed_at?: string | null;
    installment_group_id?: string | null;
    installment_number?: number | null;
    installment_total?: number | null;
    notes: string | null;
    related_transaction_id?: string | null;
  }>;
  const mappedTransactions = transactions
    .map((transaction) => ({
      ...transaction,
      amount: Number(transaction.amount),
      entryKind: transaction.entry_kind,
      installmentCompletedAt: transaction.installment_completed_at,
      installmentGroupId: transaction.installment_group_id,
      installmentNumber: transaction.installment_number,
      installmentTotal: transaction.installment_total,
      notes: transaction.notes ? decryptField(transaction.notes) : null,
      relatedTransactionId: transaction.related_transaction_id ?? null,
      type: transaction.kind,
    }))
    .filter(
      (transaction) => !isRetiredFutureInstallmentProjection(transaction),
    );
  const incomeTransactions = mappedTransactions.filter(
    (transaction) => getIncomeAmount(transaction) > 0,
  );
  const actualIncome = incomeTransactions.reduce(
    (sum, transaction) => sum + getIncomeAmount(transaction),
    0,
  );
  const spent = mappedTransactions.reduce(
    (sum, transaction) =>
      sum + getPersonalSpendingAmount(transaction, mappedTransactions),
    0,
  );
  const paidByCommitment = new Map<string, number>();

  for (const transaction of mappedTransactions) {
    if (transaction.kind !== "expense" || !transaction.fixed_commitment_id)
      continue;
    paidByCommitment.set(
      transaction.fixed_commitment_id,
      (paidByCommitment.get(transaction.fixed_commitment_id) ?? 0) +
        Math.abs(Number(transaction.amount)),
    );
  }

  const monthCommitments = getFixedCommitmentsForMonth(commitments, month);
  const commitmentDetails = monthCommitments.map((commitment) => {
    const monthlyAmount = toMonthlyAmount(
      commitment.amount,
      commitment.cadence,
      commitment.customIntervalMonths,
    );
    const paidAmount = paidByCommitment.get(commitment.id) ?? 0;
    return {
      ...commitment,
      monthlyAmount,
      paidAmount,
      remainingAmount: Math.max(monthlyAmount - paidAmount, 0),
    };
  });
  const futureReserves = sinkingFunds
    .filter((fund) => fund.isEnabled)
    .reduce((sum, fund) => sum + fund.monthlyTarget, 0);
  const longTermSavings = Number(budgetResult.data?.savings_limit ?? 0);
  const paidFixedCommitments = commitmentDetails.reduce(
    (sum, commitment) => sum + commitment.paidAmount,
    0,
  );
  const nextDue = invoiceTransactions
    .filter(
      (transaction) =>
        transaction.isCreditCardInvoice &&
        transaction.amount < 0 &&
        transaction.date >= `${month}-01`,
    )
    .sort((left, right) => left.date.localeCompare(right.date))[0];
  const monthlyBudgetIncome =
    budgetResult.data?.income == null ? 0 : Number(budgetResult.data.income);
  const incomeUsesBudgetFallback =
    incomeTransactions.length === 0 && budgetResult.data?.income != null;
  const incomeUsed = incomeUsesBudgetFallback
    ? monthlyBudgetIncome
    : actualIncome;
  const monthlyAmountConfigured =
    budgetResult.data?.income != null || incomeTransactions.length > 0;
  const assetAccounts = accountBalances.filter(
    (account) => account.type !== "credit",
  );
  const dataQuality =
    monthlyAmountConfigured &&
    assetAccounts.length > 0 &&
    assetAccounts.every(
      (account) =>
        account.balanceTrackingEnabled && account.currentBalance != null,
    )
      ? "verified"
      : "partial";
  const accountFunds = summarizeAccountFunds(accountBalances);

  return {
    accountBalances,
    fixedCommitments: commitmentDetails,
    month,
    monthlyAmountConfigured,
    nextDue: nextDue
      ? {
          amount: Math.abs(nextDue.amount),
          date: nextDue.date,
          descriptionKey: nextDue.descriptionKey,
        }
      : null,
    refreshedAt: new Date().toISOString(),
    safeToSpend: calculateSafeToSpend({
      dataQuality,
      fixedCommitments: monthCommitments.map((commitment) => ({
        amount: commitment.amount,
        cadence: commitment.cadence,
        customIntervalMonths: commitment.customIntervalMonths,
        includeInSafeToSpend: commitment.includeInSafeToSpend,
        paidAmount: paidByCommitment.get(commitment.id) ?? 0,
      })),
      futureReserves,
      income: incomeUsed,
      incomeIsForecast: incomeUsesBudgetFallback,
      longTermSavings,
      monthlyReserve: futureReserves + longTermSavings,
      spent,
      unprepaidDailySpent: Math.max(spent - paidFixedCommitments, 0),
    }),
    sinkingFunds,
    totalAssets: accountFunds.assets,
    totalLiabilities: accountFunds.liabilities,
    netFunds: accountFunds.netFunds,
  };
}

export async function setMonthlyAvailableIncome(
  input: { month: string; amount: number },
  userContext?: AuthenticatedUserContext,
) {
  const ctx = await resolveContext(userContext);
  assertMonth(input.month, "Month");
  assertNonNegative(input.amount, "Monthly available income");
  const amount = centsToMoney(parseMoneyToCents(input.amount));
  const { error } = await ctx.supabase.from("monthly_budgets").upsert(
    {
      month: `${input.month}-01`,
      user_id: ctx.userId,
      income: amount,
    },
    { onConflict: "user_id,month" },
  );
  if (error)
    throw new Error(
      `Unable to save monthly available income: ${error.message}`,
    );
}

export async function getFunMoneyOverview(
  month: string,
  userContext?: AuthenticatedUserContext,
): Promise<FunMoneyOverview> {
  const ctx = await resolveContext(userContext);
  assertMonth(month, "Month");
  const [budgetResult, transactionResult] = await Promise.all([
    ctx.supabase
      .from("monthly_budgets")
      .select("wants_limit")
      .eq("user_id", ctx.userId)
      .eq("month", `${month}-01`)
      .maybeSingle(),
    ctx.supabase
      .from("transactions")
      .select(
        "id, amount, date, kind, entry_kind, related_transaction_id, counts_toward_fun_money, deleted_at",
      )
      .eq("user_id", ctx.userId)
      .gte("date", `${month}-01`)
      .lt("date", `${nextMonth(month)}-01`)
      .is("deleted_at", null),
  ]);

  if (budgetResult.error && budgetResult.error.code !== "PGRST116") {
    throw new Error(
      `Unable to load happy money budget: ${budgetResult.error.message}`,
    );
  }
  if (transactionResult.error) {
    throw new Error(
      `Unable to load happy money spending: ${transactionResult.error.message}`,
    );
  }

  const transactions = (transactionResult.data ?? []) as Array<{
    amount: number | string;
    counts_toward_fun_money: boolean;
    date: string;
    deleted_at: string | null;
    entry_kind: string;
    id: string;
    kind: "expense" | "income" | "saving";
    related_transaction_id: string | null;
  }>;
  const spent = sumFunMoneyTransactions(
    transactions.map((transaction) => ({
      amount: transaction.amount,
      countsTowardFunMoney: transaction.counts_toward_fun_money,
      date: transaction.date,
      deletedAt: transaction.deleted_at,
      entryKind: transaction.entry_kind,
      id: transaction.id,
      kind: transaction.kind,
      relatedTransactionId: transaction.related_transaction_id,
    })),
    month,
  );
  const status = calculateFunMoneyStatus({
    budget: Number(budgetResult.data?.wants_limit ?? 0),
    spent,
  });

  return { ...status, month };
}

export async function setFunMoneyBudget(
  input: FunMoneyBudgetInput,
  userContext?: AuthenticatedUserContext,
) {
  const ctx = await resolveContext(userContext);
  assertMonth(input.month, "Month");
  assertNonNegative(input.amount, "Happy money budget");

  const { error } = await ctx.supabase.from("monthly_budgets").upsert(
    {
      month: `${input.month}-01`,
      user_id: ctx.userId,
      wants_limit: Number(input.amount.toFixed(2)),
    },
    { onConflict: "user_id,month" },
  );

  if (error) {
    throw new Error(`Unable to save happy money budget: ${error.message}`);
  }
}

function nextMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

type ModeledInstallmentPlanRow = {
  amount_mode: string;
  current_installment: number;
  deleted_at: string | null;
  description: string;
  entered_amount: number;
  id: string;
  installment_amount: number;
  status: string;
  total_amount: number;
  total_installments: number;
};

type ModeledInstallmentOccurrenceRow = {
  amount: number;
  due_date: string;
  installment_number: number;
  plan_id: string;
  status: string;
};

function indexOccurrencesByPlan(
  occurrences: ModeledInstallmentOccurrenceRow[],
) {
  const indexed = new Map<string, ModeledInstallmentOccurrenceRow[]>();
  for (const occurrence of occurrences) {
    const planOccurrences = indexed.get(occurrence.plan_id) ?? [];
    planOccurrences.push(occurrence);
    indexed.set(occurrence.plan_id, planOccurrences);
  }
  return indexed;
}

function modeledInstallmentEnd(
  storedPlan: ModeledInstallmentPlanRow,
  occurrences: ModeledInstallmentOccurrenceRow[],
) {
  const last = occurrences.at(-1);
  return {
    dueDate: last ? last.due_date : "",
    monthlyAmount: Number(last ? last.amount : storedPlan.installment_amount),
  };
}

function isModeledInstallmentRetired(status: string, dueDate: string) {
  if (status === "completed") return true;
  if (!dueDate) return false;
  return dueDate < new Date().toISOString().slice(0, 10);
}

function toModeledInstallmentOverview(
  storedPlan: ModeledInstallmentPlanRow,
  occurrences: ModeledInstallmentOccurrenceRow[],
  allocations: InstallmentRetirementAllocation[],
): InstallmentOverviewItem {
  const amountMode = storedPlan.amount_mode as InstallmentAmountMode;
  const computed = buildInstallmentPlan({
    amount: Number(storedPlan.entered_amount),
    amountMode,
    currentInstallment: storedPlan.current_installment,
    installmentCount: storedPlan.total_installments,
  });
  const end = modeledInstallmentEnd(storedPlan, occurrences);
  const paidAmount = Number(
    computed.installmentAmounts
      .slice(0, storedPlan.current_installment)
      .reduce((sum, amount) => sum + amount, 0)
      .toFixed(2),
  );
  return {
    allocations: allocations.filter(
      (allocation) => allocation.installmentGroupId === storedPlan.id,
    ),
    amountMode,
    currentInstallment: storedPlan.current_installment,
    endDate: end.dueDate,
    groupId: storedPlan.id,
    monthlyAmount: end.monthlyAmount,
    name: decryptField(storedPlan.description) || "Installment",
    paidAmount,
    paidInstallments: storedPlan.current_installment,
    remainingAmount: computed.remainingAmount,
    remainingInstallments: computed.remainingInstallments,
    retired: isModeledInstallmentRetired(storedPlan.status, end.dueDate),
    retirementStartsMonth: end.dueDate
      ? nextMonth(end.dueDate.slice(0, 7))
      : "",
    totalAmount: Number(storedPlan.total_amount),
    totalInstallments: storedPlan.total_installments,
  };
}

async function listModeledInstallmentOverview(
  ctx: AuthenticatedUserContext,
  allocations: InstallmentRetirementAllocation[],
  includeDeleted: boolean,
) {
  const [plans, occurrences] = await Promise.all([
    ctx.supabase
      .from("installment_plans")
      .select(
        "id, description, amount_mode, entered_amount, installment_amount, total_amount, current_installment, total_installments, status, deleted_at",
      )
      .eq("user_id", ctx.userId),
    ctx.supabase
      .from("installment_occurrences")
      .select("plan_id, installment_number, amount, due_date, status")
      .eq("user_id", ctx.userId)
      .is("deleted_at", null)
      .order("installment_number"),
  ]);
  if (plans.error)
    throw new Error(`Unable to load installment plans: ${plans.error.message}`);
  if (occurrences.error)
    throw new Error(
      `Unable to load installment occurrences: ${occurrences.error.message}`,
    );
  const indexed = indexOccurrencesByPlan(occurrences.data ?? []);
  const storedPlans = plans.data ?? [];
  return {
    allPlanIds: storedPlans.map((plan) => plan.id),
    items: storedPlans
      .filter((plan) => includeDeleted || plan.deleted_at === null)
      .map((plan) => ({
        ...toModeledInstallmentOverview(
          plan,
          indexed.get(plan.id) ?? [],
          allocations,
        ),
        ...(plan.deleted_at ? { archivedAt: plan.deleted_at } : {}),
      })),
  };
}

export async function getInstallmentOverview(
  userContext?: AuthenticatedUserContext,
  options: { includeDeleted?: boolean } = {},
): Promise<InstallmentOverviewItem[]> {
  const ctx = await resolveContext(userContext);
  const [transactions, allocations] = await Promise.all([
    listTransactions({ includeFuture: true, userContext: ctx }),
    listInstallmentRetirementAllocations(undefined, ctx),
  ]);
  const modeled = await listModeledInstallmentOverview(
    ctx,
    allocations,
    options.includeDeleted === true,
  );
  const today = new Date().toISOString().slice(0, 10);
  const groups = groupTransactionsByInstallmentGroup(transactions);
  for (const planId of modeled.allPlanIds) groups.delete(planId);

  const legacyPlans = [...groups.entries()].map(([groupId, group]) => {
    const first = group[0];
    const last = group[group.length - 1];
    const amountMode = first?.installmentAmountMode ?? "total";
    const hasExplicitCurrent = first?.installmentCurrentNumber != null;
    const paidTransactions = group.filter(
      (transaction) => String(transaction.date ?? "") <= today,
    );
    const currentInstallment = hasExplicitCurrent
      ? Number(first?.installmentCurrentNumber)
      : paidTransactions.length;
    const totalAmount = Number(
      group
        .reduce(
          (sum, transaction) => sum + Math.abs(Number(transaction.amount ?? 0)),
          0,
        )
        .toFixed(2),
    );
    const datePaidAmount = Number(
      paidTransactions
        .reduce(
          (sum, transaction) => sum + Math.abs(Number(transaction.amount ?? 0)),
          0,
        )
        .toFixed(2),
    );
    const paidAmount = hasExplicitCurrent
      ? Number(
          group
            .filter(
              (transaction) =>
                Number(transaction.installmentNumber ?? 0) <=
                currentInstallment,
            )
            .reduce(
              (sum, transaction) => sum + Math.abs(Number(transaction.amount)),
              0,
            )
            .toFixed(2),
        )
      : datePaidAmount;
    const resolvedTotalAmount =
      amountMode === "per_installment" && first?.installmentAmount != null
        ? Number(first.installmentAmount) * group.length
        : totalAmount;
    const plan = buildInstallmentPlan({
      amount:
        amountMode === "per_installment"
          ? Number(first?.installmentAmount ?? Math.abs(Number(first?.amount)))
          : resolvedTotalAmount,
      amountMode,
      currentInstallment: Math.max(currentInstallment, 1),
      installmentCount: group.length,
    });
    const rawName = String(first?.descriptionKey ?? "Installment");
    const suffixStart = rawName.lastIndexOf(" (");
    const suffix = suffixStart < 0 ? "" : rawName.slice(suffixStart + 2, -1);
    const name = /^\d+\/\d+$/.test(suffix)
      ? rawName.slice(0, suffixStart).trim()
      : rawName;
    return {
      amountMode,
      currentInstallment,
      monthlyAmount:
        amountMode === "per_installment"
          ? Number(
              first?.installmentAmount ?? Math.abs(Number(last?.amount ?? 0)),
            )
          : Math.abs(Number(last?.amount ?? 0)),
      retirementStartsMonth: nextMonth(String(last?.date ?? "").slice(0, 7)),
      allocations: allocations.filter(
        (allocation) => allocation.installmentGroupId === groupId,
      ),
      endDate: String(last?.date ?? ""),
      groupId,
      name,
      paidAmount,
      paidInstallments: hasExplicitCurrent
        ? currentInstallment
        : paidTransactions.length,
      remainingAmount: hasExplicitCurrent
        ? plan.remainingAmount
        : Number(Math.max(totalAmount - paidAmount, 0).toFixed(2)),
      remainingInstallments: Math.max(group.length - currentInstallment, 0),
      retired:
        group.some((transaction) => transaction.installmentCompletedAt) ||
        String(last?.date ?? "") < today,
      totalAmount: resolvedTotalAmount,
      totalInstallments: group.length,
    };
  });

  return [...modeled.items, ...legacyPlans];
}
