import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptField } from "@/lib/crypto/field-encryption";
import {
  getUserContext,
  type AuthenticatedUserContext,
} from "@/lib/finance/transactions";
import { isRetiredFutureInstallmentProjection } from "@/lib/finance/installments";
import {
  getSpendingAmount,
  isRepaymentTransaction,
  isSpendingTransaction,
} from "@/lib/finance/transaction-semantics";

export type AccountBalanceTransaction = {
  amount: number | string;
  date: string;
  entryKind?:
    "purchase" | "repayment" | "refund" | "reimbursement" | "transfer" | null;
  kind: "expense" | "income" | "saving";
  installmentCompletedAt?: string | null;
  installmentGroupId?: string | null;
  installmentNumber?: number | null;
  installmentTotal?: number | null;
  notes?: string | null;
  paymentMethodId?: string | null;
  relatedInvoiceId?: string | null;
};

export type AccountBalanceEntry = {
  amount: number | string;
  effective_date: string;
  entry_type: "adjustment" | "opening_balance";
  id: string;
  idempotency_key: string | null;
  note: string | null;
  payment_method_id: string;
};

export type AccountBalance = {
  balanceTrackingEnabled: boolean;
  currentBalance: number | null;
  currentBalanceCents: number | null;
  currentLiability: number | null;
  currentLiabilityCents: number | null;
  id: string;
  name: string;
  openingBalance: number | null;
  openingBalanceCents: number | null;
  openingDate: string | null;
  type: string;
};

type PaymentMethodBalanceRow = {
  balance_tracking_enabled: boolean;
  id: string;
  name: string;
  type: string;
};

type MoneyInput = number | string;

export function parseMoneyToCents(value: MoneyInput) {
  const normalized = String(value).trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Amount must have at most two decimal places.");
  }

  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ""] = unsigned.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));

  if (!Number.isSafeInteger(cents)) {
    throw new Error("Amount is too large.");
  }

  return negative ? -cents : cents;
}

export function centsToMoney(cents: number) {
  if (!Number.isSafeInteger(cents)) throw new Error("Amount is invalid.");
  return Number((cents / 100).toFixed(2));
}

export function sumTrackedAccountAssets(
  accounts: Array<Pick<AccountBalance, "currentBalanceCents">>,
) {
  const cents = accounts.reduce<number>(
    (total, account) => total + (account.currentBalanceCents ?? 0),
    0,
  );
  return { amount: centsToMoney(cents), cents };
}

export function summarizeAccountFunds(
  accounts: Array<
    Pick<
      AccountBalance,
      "currentBalanceCents" | "currentLiabilityCents" | "type"
    >
  >,
) {
  const assetsCents = accounts.reduce(
    (sum, account) =>
      sum +
      (account.type === "credit" ? 0 : (account.currentBalanceCents ?? 0)),
    0,
  );
  const liabilityCents = accounts.reduce(
    (sum, account) =>
      sum +
      (account.type === "credit" ? (account.currentLiabilityCents ?? 0) : 0),
    0,
  );
  return {
    assets: centsToMoney(assetsCents),
    liabilities: centsToMoney(liabilityCents),
    netFunds: centsToMoney(assetsCents - liabilityCents),
  };
}

export function calculateAccountBalance(input: {
  adjustments: MoneyInput[];
  openingBalance: MoneyInput | null;
  openingDate?: string | null;
  transactions: AccountBalanceTransaction[];
}) {
  const openingBalanceCents = input.openingBalance
    ? parseMoneyToCents(input.openingBalance)
    : 0;
  const adjustmentCents = input.adjustments.reduce<number>(
    (total, amount) => total + parseMoneyToCents(amount),
    0,
  );
  const transactionCents = input.transactions
    .filter(
      (transaction) =>
        !input.openingDate || transaction.date > input.openingDate,
    )
    .reduce<number>((total, transaction) => {
      const cents = parseMoneyToCents(transaction.amount);
      return total + (transaction.kind === "income" ? cents : -cents);
    }, 0);
  const cents = openingBalanceCents + adjustmentCents + transactionCents;

  return { amount: centsToMoney(cents), cents };
}

function getLegacyInvoiceId(notes: string | null | undefined) {
  return notes?.startsWith("invoice_advance:")
    ? notes.slice("invoice_advance:".length)
    : null;
}

function asSpendingTransaction(transaction: AccountBalanceTransaction) {
  return {
    ...transaction,
    amount: Number(transaction.amount),
    entryKind: transaction.entryKind ?? undefined,
    type: transaction.kind,
  };
}

function getCardPurchaseCents(
  cardId: string,
  transactions: AccountBalanceTransaction[],
) {
  return transactions
    .filter(
      (transaction) =>
        transaction.paymentMethodId === cardId &&
        isSpendingTransaction(asSpendingTransaction(transaction)),
    )
    .reduce(
      (total, transaction) =>
        total +
        parseMoneyToCents(
          getSpendingAmount(asSpendingTransaction(transaction)),
        ),
      0,
    );
}

function getCardRepaymentCents(
  cardId: string,
  transactions: AccountBalanceTransaction[],
) {
  const invoicePrefix = `credit-card-invoice:${cardId}:`;
  return transactions
    .filter((transaction) => {
      if (
        !isRepaymentTransaction({
          entryKind: transaction.entryKind ?? undefined,
          notes: transaction.notes,
        })
      ) {
        return false;
      }
      const invoiceId =
        transaction.relatedInvoiceId ?? getLegacyInvoiceId(transaction.notes);
      return invoiceId?.startsWith(invoicePrefix) === true;
    })
    .reduce(
      (total, transaction) =>
        total + parseMoneyToCents(Math.abs(Number(transaction.amount))),
      0,
    );
}

export function calculateCreditCardLiability(input: {
  adjustments?: MoneyInput[];
  cardId: string;
  openingBalance?: MoneyInput | null;
  openingDate?: string | null;
  transactions: AccountBalanceTransaction[];
}) {
  const openingBalanceCents = input.openingBalance
    ? parseMoneyToCents(input.openingBalance)
    : 0;
  const adjustmentCents = (input.adjustments ?? []).reduce<number>(
    (total, amount) => total + parseMoneyToCents(amount),
    0,
  );
  const transactions = input.transactions.filter(
    (transaction) =>
      (!input.openingDate || transaction.date > input.openingDate) &&
      !isRetiredFutureInstallmentProjection(transaction),
  );
  const purchaseCents = getCardPurchaseCents(input.cardId, transactions);
  const repaymentCents = getCardRepaymentCents(input.cardId, transactions);
  const cents = Math.max(
    openingBalanceCents + adjustmentCents + purchaseCents - repaymentCents,
    0,
  );

  return { amount: centsToMoney(cents), cents };
}

export async function listAccountBalances(
  userContext?: AuthenticatedUserContext,
  asOfDate?: string,
): Promise<AccountBalance[]> {
  const ctx = userContext ?? (await getUserContext());
  if (asOfDate && !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    throw new Error("Balance date is invalid.");
  }
  let entriesQuery = ctx.supabase
    .from("account_balance_entries")
    .select(
      "id, payment_method_id, entry_type, amount, effective_date, note, idempotency_key",
    )
    .eq("user_id", ctx.userId);
  let transactionsQuery = ctx.supabase
    .from("transactions")
    .select(
      "payment_method_id, kind, amount, date, entry_kind, related_invoice_id, notes, installment_group_id, installment_number, installment_total, installment_completed_at",
    )
    .eq("user_id", ctx.userId)
    .not("payment_method_id", "is", null)
    .is("deleted_at", null);
  if (asOfDate) {
    entriesQuery = entriesQuery.lte("effective_date", asOfDate);
    transactionsQuery = transactionsQuery.lte("date", asOfDate);
  }
  const [paymentMethodsResult, entriesResult, transactionsResult] =
    await Promise.all([
      ctx.supabase
        .from("payment_methods")
        .select("id, name, type, balance_tracking_enabled")
        .eq("user_id", ctx.userId)
        .is("deleted_at", null)
        .order("name", { ascending: true }),
      entriesQuery.order("effective_date", { ascending: true }),
      transactionsQuery,
    ]);

  if (paymentMethodsResult.error)
    throw new Error(
      `Unable to load payment accounts: ${paymentMethodsResult.error.message}`,
    );
  if (entriesResult.error)
    throw new Error(
      `Unable to load account balances: ${entriesResult.error.message}`,
    );
  if (transactionsResult.error)
    throw new Error(
      `Unable to load account transactions: ${transactionsResult.error.message}`,
    );

  const entries = (entriesResult.data ?? []) as AccountBalanceEntry[];
  const transactions = (transactionsResult.data ?? []).map((transaction) => ({
    amount: transaction.amount,
    date: transaction.date,
    entryKind: transaction.entry_kind,
    installmentCompletedAt: transaction.installment_completed_at,
    installmentGroupId: transaction.installment_group_id,
    installmentNumber:
      transaction.installment_number == null
        ? null
        : Number(transaction.installment_number),
    installmentTotal:
      transaction.installment_total == null
        ? null
        : Number(transaction.installment_total),
    kind: transaction.kind,
    notes: transaction.notes ? decryptField(transaction.notes) : null,
    paymentMethodId: transaction.payment_method_id,
    relatedInvoiceId: transaction.related_invoice_id,
  })) as AccountBalanceTransaction[];
  const entriesByAccount = new Map<string, AccountBalanceEntry[]>();
  const transactionsByAccount = new Map<string, AccountBalanceTransaction[]>();

  for (const entry of entries) {
    const accountEntries = entriesByAccount.get(entry.payment_method_id) ?? [];
    accountEntries.push(entry);
    entriesByAccount.set(entry.payment_method_id, accountEntries);
  }
  for (const transaction of transactions) {
    if (!transaction.paymentMethodId) continue;
    const accountTransactions =
      transactionsByAccount.get(transaction.paymentMethodId) ?? [];
    accountTransactions.push(transaction);
    transactionsByAccount.set(transaction.paymentMethodId, accountTransactions);
  }

  return ((paymentMethodsResult.data ?? []) as PaymentMethodBalanceRow[]).map(
    (paymentMethod) => {
      const accountEntries = entriesByAccount.get(paymentMethod.id) ?? [];
      const opening = accountEntries.find(
        (entry) => entry.entry_type === "opening_balance",
      );
      const creditCardLiability =
        paymentMethod.type === "credit"
          ? calculateCreditCardLiability({
              adjustments: accountEntries
                .filter((entry) => entry.entry_type === "adjustment")
                .map((entry) => entry.amount),
              cardId: paymentMethod.id,
              openingBalance: opening?.amount ?? null,
              openingDate: opening?.effective_date ?? null,
              transactions,
            })
          : null;
      if (!paymentMethod.balance_tracking_enabled) {
        return {
          balanceTrackingEnabled: false,
          currentBalance: null,
          currentBalanceCents: null,
          currentLiability: creditCardLiability?.amount ?? null,
          currentLiabilityCents: creditCardLiability?.cents ?? null,
          id: paymentMethod.id,
          name: paymentMethod.name,
          openingBalance: opening ? Number(opening.amount) : null,
          openingBalanceCents: opening
            ? parseMoneyToCents(opening.amount)
            : null,
          openingDate: opening?.effective_date ?? null,
          type: paymentMethod.type,
        };
      }

      const calculated = calculateAccountBalance({
        adjustments: accountEntries
          .filter((entry) => entry.entry_type === "adjustment")
          .map((entry) => entry.amount),
        openingBalance: opening?.amount ?? null,
        openingDate: opening?.effective_date ?? null,
        transactions: transactionsByAccount.get(paymentMethod.id) ?? [],
      });

      return {
        balanceTrackingEnabled: true,
        currentBalance:
          paymentMethod.type === "credit" ? null : calculated.amount,
        currentBalanceCents:
          paymentMethod.type === "credit" ? null : calculated.cents,
        currentLiability: creditCardLiability?.amount ?? null,
        currentLiabilityCents: creditCardLiability?.cents ?? null,
        id: paymentMethod.id,
        name: paymentMethod.name,
        openingBalance: opening ? Number(opening.amount) : null,
        openingBalanceCents: opening ? parseMoneyToCents(opening.amount) : null,
        openingDate: opening?.effective_date ?? null,
        type: paymentMethod.type,
      };
    },
  );
}

async function getOwnedAccount(
  supabase: SupabaseClient,
  userId: string,
  paymentMethodId: string,
) {
  const { data, error } = await supabase
    .from("payment_methods")
    .select("id, balance_tracking_enabled")
    .eq("id", paymentMethodId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error)
    throw new Error(`Unable to load payment account: ${error.message}`);
  if (!data) throw new Error("Payment account not found.");
  return data as { balance_tracking_enabled: boolean; id: string };
}

function assertDateValue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Effective date is invalid.");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (date.toISOString().slice(0, 10) !== value) {
    throw new Error("Effective date is invalid.");
  }
}

export async function setAccountOpeningBalance(input: {
  amount: MoneyInput;
  effectiveDate: string;
  paymentMethodId: string;
  userContext?: AuthenticatedUserContext;
}) {
  const ctx = input.userContext ?? (await getUserContext());
  const amountCents = parseMoneyToCents(input.amount);
  if (amountCents < 0) throw new Error("Opening balance cannot be negative.");
  assertDateValue(input.effectiveDate);
  await getOwnedAccount(ctx.supabase, ctx.userId, input.paymentMethodId);

  const payload = {
    amount: centsToMoney(amountCents),
    effective_date: input.effectiveDate,
    entry_type: "opening_balance" as const,
    payment_method_id: input.paymentMethodId,
    user_id: ctx.userId,
  };
  const existingResult = await ctx.supabase
    .from("account_balance_entries")
    .select("id, amount, effective_date")
    .eq("user_id", ctx.userId)
    .eq("payment_method_id", input.paymentMethodId)
    .eq("entry_type", "opening_balance")
    .maybeSingle();
  if (existingResult.error)
    throw new Error(
      `Unable to load opening balance: ${existingResult.error.message}`,
    );

  if (existingResult.data) {
    const existing = existingResult.data as {
      amount: number | string;
      effective_date: string;
      id: string;
    };
    if (
      parseMoneyToCents(existing.amount) !== amountCents ||
      existing.effective_date !== input.effectiveDate
    ) {
      throw new Error(
        "Opening balance already exists; use a balance adjustment for corrections.",
      );
    }
  } else {
    const { error } = await ctx.supabase
      .from("account_balance_entries")
      .insert(payload);
    if (error) {
      if (error.code !== "23505") {
        throw new Error(`Unable to save opening balance: ${error.message}`);
      }

      const concurrent = await ctx.supabase
        .from("account_balance_entries")
        .select("amount, effective_date")
        .eq("user_id", ctx.userId)
        .eq("payment_method_id", input.paymentMethodId)
        .eq("entry_type", "opening_balance")
        .maybeSingle();
      if (
        concurrent.error ||
        !concurrent.data ||
        parseMoneyToCents(concurrent.data.amount) !== amountCents ||
        concurrent.data.effective_date !== input.effectiveDate
      ) {
        throw new Error(`Unable to save opening balance: ${error.message}`);
      }
    }
  }

  const { error: enableError } = await ctx.supabase
    .from("payment_methods")
    .update({ balance_tracking_enabled: true })
    .eq("id", input.paymentMethodId)
    .eq("user_id", ctx.userId);
  if (enableError)
    throw new Error(
      `Unable to enable balance tracking: ${enableError.message}`,
    );
}

export async function addAccountBalanceAdjustment(input: {
  amount: MoneyInput;
  effectiveDate: string;
  note?: string | null;
  paymentMethodId: string;
  userContext?: AuthenticatedUserContext;
}) {
  const ctx = input.userContext ?? (await getUserContext());
  const amountCents = parseMoneyToCents(input.amount);
  if (amountCents === 0) throw new Error("Adjustment cannot be zero.");
  assertDateValue(input.effectiveDate);
  await getOwnedAccount(ctx.supabase, ctx.userId, input.paymentMethodId);

  const { error } = await ctx.supabase.from("account_balance_entries").insert({
    amount: centsToMoney(amountCents),
    effective_date: input.effectiveDate,
    entry_type: "adjustment" as const,
    note: input.note?.trim() || null,
    payment_method_id: input.paymentMethodId,
    user_id: ctx.userId,
  });
  if (error)
    throw new Error(`Unable to save balance adjustment: ${error.message}`);
}
