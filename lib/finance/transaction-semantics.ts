import type { Transaction } from "@/lib/data";

export function isRepaymentTransaction(
  transaction: Pick<Transaction, "entryKind" | "notes">,
) {
  return (
    transaction.entryKind === "repayment" ||
    transaction.notes?.startsWith("invoice_advance:") === true
  );
}

export function isSpendingTransaction(
  transaction: Pick<Transaction, "amount" | "entryKind" | "notes" | "type">,
) {
  if (transaction.type !== "expense") return false;
  if (
    transaction.entryKind === "transfer" ||
    isRepaymentTransaction(transaction)
  ) {
    return false;
  }
  return true;
}

export function getSpendingAmount(
  transaction: Pick<Transaction, "amount" | "entryKind" | "notes" | "type">,
) {
  if (!isSpendingTransaction(transaction)) return 0;
  return transaction.entryKind === "refund"
    ? -Math.abs(Number(transaction.amount))
    : Math.abs(Number(transaction.amount));
}

export function getIncomeAmount(
  transaction: Pick<Transaction, "amount" | "entryKind" | "type">,
) {
  if (transaction.type !== "income") return 0;
  if (
    transaction.entryKind === "reimbursement" ||
    transaction.entryKind === "transfer"
  ) {
    return 0;
  }
  return Math.abs(Number(transaction.amount));
}

export function getPersonalSpendingAmount(
  transaction: Pick<
    Transaction,
    "amount" | "entryKind" | "id" | "notes" | "type"
  >,
  reimbursements: Array<
    Pick<
      Transaction,
      "amount" | "entryKind" | "notes" | "relatedTransactionId" | "type"
    >
  >,
) {
  const spendingAmount = getSpendingAmount(transaction);
  if (spendingAmount <= 0) return spendingAmount;

  const reimbursedAmount = reimbursements.reduce((total, reimbursement) => {
    if (
      reimbursement.entryKind !== "reimbursement" ||
      reimbursement.relatedTransactionId !== transaction.id
    ) {
      return total;
    }
    return total + Math.abs(Number(reimbursement.amount));
  }, 0);

  return Number(Math.max(0, spendingAmount - reimbursedAmount).toFixed(2));
}

export function getPurchaseMonth(transaction: Pick<Transaction, "date">) {
  return transaction.date.slice(0, 7);
}
