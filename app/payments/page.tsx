import { AppShell } from "@/components/dashboard/app-shell";
import { AccountBalancesPanel } from "@/components/dashboard/account-balances-panel";
import { PaymentsScreen } from "@/components/dashboard/payments-screen";
import {
  addAccountBalanceAdjustmentAction,
  createPaymentMethodAction,
  createInvoiceAdvancePaymentAction,
  createSubscriptionAction,
  deletePaymentMethodAction,
  deleteSubscriptionAction,
  pauseSubscriptionAction,
  resumeSubscriptionAction,
  setAccountOpeningBalanceAction,
  updatePaymentMethodAction,
  updateSubscriptionAction,
} from "@/app/transactions/actions";
import {
  getPaymentsDueData,
  getTransactionFormOptions,
  listPaymentMethodOverview,
  listSubscriptionOverview,
} from "@/lib/finance/transactions";
import { listAccountBalances } from "@/lib/finance/account-balances";

type PaymentsPageProps = {
  readonly searchParams?: Promise<{
    month?: string | string[];
  }>;
};

function getCurrentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeMonthValue(month?: string) {
  return month?.match(/^\d{4}-\d{2}$/) ? month : getCurrentMonthValue();
}

function addCurrentLiabilities(
  paymentMethods: Awaited<ReturnType<typeof listPaymentMethodOverview>>,
  accountBalances: Awaited<ReturnType<typeof listAccountBalances>>,
) {
  const balancesByAccountId = new Map(
    accountBalances.map((account) => [account.id, account]),
  );
  return paymentMethods.map((paymentMethod) => ({
    ...paymentMethod,
    currentLiability:
      paymentMethod.type === "credit"
        ? (balancesByAccountId.get(paymentMethod.id)?.currentLiability ?? 0)
        : null,
  }));
}

export default async function PaymentsPage({
  searchParams,
}: PaymentsPageProps) {
  const resolvedSearchParams = await searchParams;
  const selectedMonth = Array.isArray(resolvedSearchParams?.month)
    ? resolvedSearchParams.month[0]
    : resolvedSearchParams?.month;
  const normalizedSelectedMonth = normalizeMonthValue(selectedMonth);
  const [
    paymentMethods,
    subscriptions,
    paymentsDueData,
    accountBalances,
    transactionFormOptions,
  ] = await Promise.all([
    listPaymentMethodOverview(normalizedSelectedMonth),
    listSubscriptionOverview(),
    getPaymentsDueData(normalizedSelectedMonth),
    listAccountBalances(),
    getTransactionFormOptions(),
  ]);
  return (
    <AppShell>
      <AccountBalancesPanel
        accounts={accountBalances}
        addAdjustmentAction={addAccountBalanceAdjustmentAction}
        setOpeningBalanceAction={setAccountOpeningBalanceAction}
      />
      <PaymentsScreen
        categories={transactionFormOptions.categories}
        createInvoiceAdvancePaymentAction={createInvoiceAdvancePaymentAction}
        createPaymentMethodAction={createPaymentMethodAction}
        createSubscriptionAction={createSubscriptionAction}
        deletePaymentMethodAction={deletePaymentMethodAction}
        deleteSubscriptionAction={deleteSubscriptionAction}
        pauseSubscriptionAction={pauseSubscriptionAction}
        paymentMethods={addCurrentLiabilities(paymentMethods, accountBalances)}
        paymentsDueData={paymentsDueData}
        resumeSubscriptionAction={resumeSubscriptionAction}
        selectedMonth={normalizedSelectedMonth}
        subscriptions={subscriptions}
        transactionPaymentMethods={transactionFormOptions.paymentMethods}
        updatePaymentMethodAction={updatePaymentMethodAction}
        updateSubscriptionAction={updateSubscriptionAction}
      />
    </AppShell>
  );
}
