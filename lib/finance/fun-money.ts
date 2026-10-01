export type FunMoneyStatus = {
  budget: number;
  budgetSet: boolean;
  isOverBudget: boolean;
  overAmount: number;
  percentage: number;
  remaining: number;
  spent: number;
};

export type FunMoneyTransaction = {
  amount: number | string;
  countsTowardFunMoney: boolean;
  date: string;
  deletedAt?: string | null;
  entryKind?: string | null;
  id?: string;
  kind: "expense" | "income" | "saving";
  relatedTransactionId?: string | null;
};

function toCents(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100);
}

export function sumFunMoneyTransactions(
  transactions: FunMoneyTransaction[],
  month: string,
) {
  const monthPrefix = `${month}-`;
  const spentCents = transactions.reduce((sum, transaction) => {
    if (
      transaction.kind !== "expense" ||
      !transaction.countsTowardFunMoney ||
      transaction.deletedAt ||
      !transaction.date.startsWith(monthPrefix)
    ) {
      return sum;
    }

    const reimbursedCents = transaction.id
      ? transactions.reduce((reimbursed, candidate) => {
          if (
            candidate.entryKind !== "reimbursement" ||
            candidate.relatedTransactionId !== transaction.id ||
            candidate.deletedAt ||
            !candidate.date.startsWith(monthPrefix)
          ) {
            return reimbursed;
          }
          return reimbursed + toCents(Number(candidate.amount));
        }, 0)
      : 0;
    return (
      sum + Math.max(toCents(Number(transaction.amount)) - reimbursedCents, 0)
    );
  }, 0);

  return spentCents / 100;
}

export function calculateFunMoneyStatus({
  budget,
  spent,
}: {
  budget: number;
  spent: number;
}): FunMoneyStatus {
  const budgetCents = toCents(budget);
  const spentCents = toCents(spent);
  const remainingCents = budgetCents - spentCents;
  const budgetSet = budgetCents > 0;
  const isOverBudget = budgetSet && remainingCents < 0;

  return {
    budget: budgetCents / 100,
    budgetSet,
    isOverBudget,
    overAmount: isOverBudget ? Math.abs(remainingCents) / 100 : 0,
    percentage:
      budgetCents > 0 ? Math.round((spentCents / budgetCents) * 100) : 0,
    remaining: budgetSet ? remainingCents / 100 : 0,
    spent: spentCents / 100,
  };
}
