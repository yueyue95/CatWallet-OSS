import { AppShell } from "@/components/dashboard/app-shell";
import { TransactionsScreen } from "@/components/dashboard/transactions-screen";
import { TransactionCenterShortcuts } from "@/components/dashboard/transaction-center-shortcuts";
import { listFixedCommitments } from "@/lib/finance/catwallet";
import {
  getUserContext,
  getMonthlySummary,
  getTransactionFormOptions,
  listAccountTransfers,
  listTransactions,
} from "@/lib/finance/transactions";
import {
  createCategoryAction,
  createAccountTransferAction,
  advanceInstallmentsAction,
  createTransactionAction,
  createReimbursementAction,
  deleteInstallmentsAction,
  deleteAccountTransferAction,
  deleteSubscriptionOccurrencesAction,
  deleteTransactionAction,
  previewInstallmentPrepaymentAction,
  updateTransactionAction,
  restoreAccountTransferAction,
  updateAccountTransferAction,
  createPaymentMethodAction,
} from "@/app/transactions/actions";

type TransactionsPageProps = {
  readonly searchParams?: Promise<{
    history?: string | string[];
    month?: string | string[];
    nextInvoice?: string | string[];
  }>;
};

function getNextMonthValue(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const nextMonth = new Date(year, monthNumber, 1);

  return `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;
}

function resolveMonthParam(value: string | string[] | undefined): string {
  return Array.isArray(value)
    ? value[0]
    : (value ?? new Date().toISOString().slice(0, 7));
}

function resolveFlagParam(value: string | string[] | undefined): boolean {
  return Array.isArray(value) ? value[0] === "1" : value === "1";
}

function toFixedCommitmentOption({
  amount,
  id,
  name,
}: Awaited<ReturnType<typeof listFixedCommitments>>[number]) {
  return { amount, id, name };
}

function resolveTransactionsPageParams(
  resolvedSearchParams: Awaited<TransactionsPageProps["searchParams"]>,
) {
  return {
    selectedMonth: resolveMonthParam(resolvedSearchParams?.month),
    showPrevious: resolveFlagParam(resolvedSearchParams?.history),
    showNextInvoice: resolveFlagParam(resolvedSearchParams?.nextInvoice),
  };
}

async function getTransactionsPageData(
  selectedMonth: string,
  showPrevious: boolean,
  userContext: Awaited<ReturnType<typeof getUserContext>>,
) {
  const nextMonth = getNextMonthValue(selectedMonth);
  const [
    transactions,
    transactionFormOptions,
    nextMonthTransactions,
    monthlySummary,
    accountTransfers,
    fixedCommitments,
  ] = await Promise.all([
    listTransactions({
      includeCreditCardInvoices: true,
      includePrevious: showPrevious,
      includeFuture: true,
      month: selectedMonth,
      preserveCreditCardInvoicePurchases: true,
      useFinancialMonth: false,
      userContext,
    }),
    getTransactionFormOptions({ userContext }),
    listTransactions({
      includeCreditCardInvoices: true,
      includeFuture: true,
      month: nextMonth,
      preserveCreditCardInvoicePurchases: true,
      useFinancialMonth: false,
      userContext,
    }),
    getMonthlySummary(selectedMonth, userContext),
    listAccountTransfers({ includeDeleted: true, userContext }),
    listFixedCommitments(userContext),
  ]);

  const nextInvoiceTransactions = nextMonthTransactions.filter(
    (transaction) => transaction.isCreditCardInvoice,
  );

  return {
    transactions,
    transactionFormOptions,
    nextInvoiceTransactions,
    monthlySummary,
    accountTransfers,
    fixedCommitments,
  };
}

export default async function TransactionsPage({
  searchParams,
}: TransactionsPageProps) {
  const resolvedSearchParams = await searchParams;
  const { selectedMonth, showPrevious, showNextInvoice } =
    resolveTransactionsPageParams(resolvedSearchParams);
  const userContext = await getUserContext();
  const {
    transactions,
    transactionFormOptions,
    nextInvoiceTransactions,
    monthlySummary,
    accountTransfers,
    fixedCommitments,
  } = await getTransactionsPageData(selectedMonth, showPrevious, userContext);

  return (
    <AppShell>
      <TransactionCenterShortcuts />
      <TransactionsScreen
        accountTransfers={accountTransfers}
        categories={transactionFormOptions.categories}
        fixedCommitments={fixedCommitments.map(toFixedCommitmentOption)}
        createCategoryAction={createCategoryAction}
        createPaymentMethodAction={createPaymentMethodAction}
        createTransactionAction={createTransactionAction}
        createAccountTransferAction={createAccountTransferAction}
        createReimbursementAction={createReimbursementAction}
        advanceInstallmentsAction={advanceInstallmentsAction}
        deleteInstallmentsAction={deleteInstallmentsAction}
        deleteAccountTransferAction={deleteAccountTransferAction}
        deleteSubscriptionOccurrencesAction={
          deleteSubscriptionOccurrencesAction
        }
        deleteTransactionAction={deleteTransactionAction}
        monthlySummary={monthlySummary}
        nextInvoiceTransactions={nextInvoiceTransactions}
        previewInstallmentPrepaymentAction={previewInstallmentPrepaymentAction}
        paymentMethods={transactionFormOptions.paymentMethods}
        showPrevious={showPrevious}
        showNextInvoice={showNextInvoice}
        transactions={transactions}
        updateTransactionAction={updateTransactionAction}
        restoreAccountTransferAction={restoreAccountTransferAction}
        updateAccountTransferAction={updateAccountTransferAction}
      />
    </AppShell>
  );
}
