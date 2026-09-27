import "server-only";

import type { Transaction } from "@/lib/data";
import {
  getCatWalletDashboardData,
  getFunMoneyOverview,
  getInstallmentOverview,
  type CatWalletDashboardData,
  type FunMoneyOverview,
  type InstallmentOverviewItem,
  type SinkingFund,
} from "@/lib/finance/catwallet";
import { listCoolingItems, type CoolingItem } from "@/lib/finance/cooling";
import {
  getUserContext,
  listTransactions,
  type AuthenticatedUserContext,
} from "@/lib/finance/transactions";
import { getSpendingAmount } from "@/lib/finance/transaction-semantics";

export type MonthlyReportSource = {
  month: string;
  transactions: Transaction[];
  dashboard: CatWalletDashboardData;
  funMoney: FunMoneyOverview;
  installments: InstallmentOverviewItem[];
  sinkingFunds: SinkingFund[];
  coolingItems: CoolingItem[];
};

export type MonthlyReportExpense = {
  amount: number;
  category: string;
  date: string;
  description: string;
  id: string;
};

export type MonthlyReport = {
  month: string;
  core: {
    income: number;
    actualExpenses: number;
    longTermSavings: number;
    sinkingFundReserve: number;
    fixedCommitments: number;
    safeToSpend: number;
    netBalance: number;
    funMoney: {
      budget: number;
      spent: number;
      remaining: number;
      percentage: number;
    };
  };
  spendingByCategory: Array<{
    amount: number;
    count: number;
    key: string;
  }>;
  specialSpending: {
    fixedCommitments: number;
    funMoney: number;
  };
  topExpenses: MonthlyReportExpense[];
  largeOneTimeExpenses: MonthlyReportExpense[];
  installments: {
    active: InstallmentOverviewItem[];
    endingThisMonth: InstallmentOverviewItem[];
    endingNextMonth: InstallmentOverviewItem[];
  };
  sinkingFunds: Array<{
    currentAmount: number;
    emoji: string;
    id: string;
    monthlyIncrease: number;
    name: string;
    progress: number | null;
    targetAmount: number | null;
  }>;
  cooling: {
    addedCount: number;
    purchasedCount: number;
    abandonedCount: number;
    abandonedAmount: number;
  };
};

function amount(value: number) {
  return Number(Math.abs(value).toFixed(2));
}

function sum(values: number[]) {
  return Number(values.reduce((total, value) => total + value, 0).toFixed(2));
}

function isLongTermSavings(transaction: Transaction) {
  return transaction.type === "saving" || transaction.group === "savings";
}

function monthOf(value: string) {
  return value.slice(0, 7);
}

function toExpense(transaction: Transaction): MonthlyReportExpense {
  return {
    amount: Number(getSpendingAmount(transaction).toFixed(2)),
    category: transaction.categoryKey,
    date: transaction.date,
    description: transaction.descriptionKey,
    id: transaction.id,
  };
}

function sortExpenses(left: MonthlyReportExpense, right: MonthlyReportExpense) {
  return right.amount - left.amount || right.date.localeCompare(left.date);
}

export function buildMonthlyReport(source: MonthlyReportSource): MonthlyReport {
  const expenses = source.transactions.filter(
    (transaction) =>
      getSpendingAmount(transaction) !== 0 && !isLongTermSavings(transaction),
  );
  const income = sum(
    source.transactions
      .filter((transaction) => transaction.type === "income")
      .map((transaction) => amount(transaction.amount)),
  );
  const actualExpenses = sum(
    expenses.map((transaction) => getSpendingAmount(transaction)),
  );
  const longTermSavings = sum(
    source.transactions
      .filter(isLongTermSavings)
      .map((transaction) => amount(transaction.amount)),
  );
  const expenseItems = expenses.map(toExpense).sort(sortExpenses);
  const categoryTotals = new Map<string, { amount: number; count: number }>();

  for (const transaction of expenses) {
    const key = transaction.categoryKey || "data.category.other";
    const current = categoryTotals.get(key) ?? { amount: 0, count: 0 };
    current.amount += getSpendingAmount(transaction);
    current.count += 1;
    categoryTotals.set(key, current);
  }

  const activeInstallments = source.installments.filter(
    (installment) => !installment.retired,
  );
  const nextMonth = new Date(
    Number(source.month.slice(0, 4)),
    Number(source.month.slice(5, 7)),
    1,
  );
  const nextMonthValue = `${nextMonth.getFullYear()}-${String(
    nextMonth.getMonth() + 1,
  ).padStart(2, "0")}`;
  const addedCoolingItems = source.coolingItems.filter(
    (item) => monthOf(item.addedAt) === source.month,
  );
  const purchasedCoolingItems = source.coolingItems.filter(
    (item) =>
      item.status === "purchased" && monthOf(item.updatedAt) === source.month,
  );
  const abandonedCoolingItems = source.coolingItems.filter(
    (item) =>
      item.status === "abandoned" && monthOf(item.updatedAt) === source.month,
  );

  return {
    month: source.month,
    core: {
      actualExpenses,
      fixedCommitments: source.dashboard.safeToSpend.fixedCommitments,
      funMoney: {
        budget: source.funMoney.budget,
        percentage:
          source.funMoney.budget > 0
            ? Number(
                (
                  (source.funMoney.spent / source.funMoney.budget) *
                  100
                ).toFixed(2),
              )
            : 0,
        remaining: source.funMoney.remaining,
        spent: source.funMoney.spent,
      },
      income,
      longTermSavings,
      netBalance: Number(
        (income - actualExpenses - longTermSavings).toFixed(2),
      ),
      safeToSpend: source.dashboard.safeToSpend.safeToSpend,
      sinkingFundReserve: source.dashboard.safeToSpend.futureReserves,
    },
    spendingByCategory: [...categoryTotals.entries()]
      .map(([key, values]) => ({
        amount: Number(values.amount.toFixed(2)),
        count: values.count,
        key,
      }))
      .sort((left, right) => right.amount - left.amount),
    specialSpending: {
      fixedCommitments: sum(
        expenses
          .filter((transaction) => transaction.fixedCommitmentId)
          .map((transaction) => getSpendingAmount(transaction)),
      ),
      funMoney: sum(
        expenses
          .filter((transaction) => transaction.countsTowardFunMoney)
          .map((transaction) => getSpendingAmount(transaction)),
      ),
    },
    topExpenses: expenseItems.slice(0, 3),
    largeOneTimeExpenses: expenseItems
      .filter(
        (transaction) =>
          transaction.amount >= 500 &&
          !expenses.find(
            (sourceTransaction) =>
              sourceTransaction.id === transaction.id &&
              sourceTransaction.installmentGroupId,
          ),
      )
      .slice(0, 5),
    installments: {
      active: activeInstallments,
      endingThisMonth: activeInstallments.filter(
        (installment) => monthOf(installment.endDate) === source.month,
      ),
      endingNextMonth: activeInstallments.filter(
        (installment) => monthOf(installment.endDate) === nextMonthValue,
      ),
    },
    sinkingFunds: source.sinkingFunds
      .filter((fund) => fund.isEnabled)
      .map((fund) => ({
        currentAmount: fund.currentAmount,
        emoji: fund.emoji,
        id: fund.id,
        monthlyIncrease: fund.monthlyTarget,
        name: fund.name,
        progress:
          fund.targetAmount && fund.targetAmount > 0
            ? Number(
                Math.min(
                  (fund.currentAmount / fund.targetAmount) * 100,
                  100,
                ).toFixed(2),
              )
            : null,
        targetAmount: fund.targetAmount,
      })),
    cooling: {
      abandonedAmount: sum(
        abandonedCoolingItems.map((item) => item.amountCents / 100),
      ),
      abandonedCount: abandonedCoolingItems.length,
      addedCount: addedCoolingItems.length,
      purchasedCount: purchasedCoolingItems.length,
    },
  };
}

export async function getMonthlyReport(
  userId: string,
  month: string,
  userContext?: AuthenticatedUserContext,
): Promise<MonthlyReport> {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("Month is invalid.");
  }

  const context = userContext ?? (await getUserContext());
  if (context.userId !== userId) {
    throw new Error("User context does not match the requested report owner.");
  }

  const [transactions, dashboard, funMoney, installments, coolingItems] =
    await Promise.all([
      listTransactions({ month, userContext: context }),
      getCatWalletDashboardData(month, context),
      getFunMoneyOverview(month, context),
      getInstallmentOverview(context),
      listCoolingItems(context),
    ]);

  return buildMonthlyReport({
    coolingItems,
    dashboard,
    funMoney,
    installments,
    month,
    sinkingFunds: dashboard.sinkingFunds,
    transactions,
  });
}
