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

export function getPurchaseMonth(transaction: Pick<Transaction, "date">) {
  return transaction.date.slice(0, 7);
}
