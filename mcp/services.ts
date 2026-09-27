import {
  getCatWalletDashboardData,
  getFunMoneyOverview,
  getInstallmentOverview,
  listFixedCommitments,
  listSinkingFunds,
} from "@/lib/finance/catwallet";
import { listCoolingItems } from "@/lib/finance/cooling";
import {
  listAccountBalances,
  type AccountBalance,
} from "@/lib/finance/account-balances";
import { getMonthlyReport } from "@/lib/finance/monthly-report";
import {
  getTransactionDirectoryOptions,
  listGoals,
  listTransactions,
  type AuthenticatedUserContext,
  type ListTransactionsOptions,
} from "@/lib/finance/transactions";
import type { Transaction } from "@/lib/data";

export type McpTransactionReadOptions = Omit<
  ListTransactionsOptions,
  "userContext"
>;

export type McpReadModels = {
  getAccountBalances: (
    date: string | undefined,
    context: AuthenticatedUserContext,
  ) => ReturnType<typeof listAccountBalances>;
  getTransactionDirectory: (
    context: AuthenticatedUserContext,
  ) => ReturnType<typeof getTransactionDirectoryOptions>;
  getDashboard: (
    month: string,
    context: AuthenticatedUserContext,
  ) => ReturnType<typeof getCatWalletDashboardData>;
  getFunMoney: (
    month: string,
    context: AuthenticatedUserContext,
  ) => ReturnType<typeof getFunMoneyOverview>;
  getInstallments: (
    context: AuthenticatedUserContext,
  ) => ReturnType<typeof getInstallmentOverview>;
  getMonthlyReport: (
    userId: string,
    month: string,
    context: AuthenticatedUserContext,
  ) => ReturnType<typeof getMonthlyReport>;
  getSafeToSpend: (
    month: string,
    context: AuthenticatedUserContext,
  ) => ReturnType<typeof getCatWalletDashboardData>;
  listCoolingItems: (
    context: AuthenticatedUserContext,
  ) => ReturnType<typeof listCoolingItems>;
  listFixedCommitments: (
    context: AuthenticatedUserContext,
    options?: { includeArchived?: boolean },
  ) => ReturnType<typeof listFixedCommitments>;
  listGoals: (
    context: AuthenticatedUserContext,
    options?: { includeArchived?: boolean },
  ) => ReturnType<typeof listGoals>;
  listSinkingFunds: (
    context: AuthenticatedUserContext,
    options?: { includeArchived?: boolean },
  ) => ReturnType<typeof listSinkingFunds>;
  listTransactions: (
    options: McpTransactionReadOptions,
    context: AuthenticatedUserContext,
  ) => Promise<Transaction[]>;
};

function accountBalanceField<K extends keyof AccountBalance>(
  balance: AccountBalance | undefined,
  key: K,
) {
  return balance?.[key] ?? null;
}

export const defaultReadModels: McpReadModels = {
  getAccountBalances: (date, context) => listAccountBalances(context, date),
  getTransactionDirectory: async (context) => {
    const [directory, accountBalances] = await Promise.all([
      getTransactionDirectoryOptions({ userContext: context }),
      listAccountBalances(context),
    ]);

    const balancesById = new Map(
      accountBalances.map((account) => [account.id, account]),
    );

    return {
      ...directory,
      paymentAccounts: directory.paymentAccounts.map((account) => {
        const balance = balancesById.get(account.id);
        return {
          ...account,
          balanceTrackingEnabled:
            accountBalanceField(balance, "balanceTrackingEnabled") ?? false,
          currentBalance: accountBalanceField(balance, "currentBalance"),
          currentLiability: accountBalanceField(balance, "currentLiability"),
          openingBalance: accountBalanceField(balance, "openingBalance"),
          openingDate: accountBalanceField(balance, "openingDate"),
        };
      }),
    };
  },
  getDashboard: (month, context) => getCatWalletDashboardData(month, context),
  getFunMoney: (month, context) => getFunMoneyOverview(month, context),
  getInstallments: (context) => getInstallmentOverview(context),
  getMonthlyReport: (userId, month, context) =>
    getMonthlyReport(userId, month, context),
  getSafeToSpend: (month, context) => getCatWalletDashboardData(month, context),
  listCoolingItems: (context) => listCoolingItems(context),
  listFixedCommitments: (context, options) =>
    listFixedCommitments(context, options),
  listGoals: (context, options) =>
    listGoals({ ...options, userContext: context }),
  listSinkingFunds: (context, options) => listSinkingFunds(context, options),
  listTransactions: (options, context) =>
    listTransactions({ ...options, userContext: context }),
};
