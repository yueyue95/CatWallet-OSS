import { InstallmentsScreen } from "@/components/catwallet/installments-screen";
import { saveInstallmentRetirementAllocationAction } from "@/app/catwallet/actions";
import {
  deleteInstallmentAction,
  previewDeleteInstallmentAction,
  restoreInstallmentAction,
} from "@/app/transactions/actions";
import { AppShell } from "@/components/dashboard/app-shell";
import {
  getInstallmentOverview,
  listSinkingFunds,
} from "@/lib/finance/catwallet";
import {
  getTransactionFormOptions,
  getUserContext,
} from "@/lib/finance/transactions";

type InstallmentsPageProps = {
  readonly searchParams?: Promise<{ view?: string | string[] }>;
};

function resolveInstallmentsView(view: string | string[] | undefined) {
  const value = Array.isArray(view) ? view[0] : view;
  return value === "deleted" ? ("deleted" as const) : ("active" as const);
}

export default async function InstallmentsPage({
  searchParams,
}: InstallmentsPageProps = {}) {
  const userContext = await getUserContext();
  const view = resolveInstallmentsView((await searchParams)?.view);
  const [allItems, formOptions, sinkingFunds] = await Promise.all([
    view === "deleted"
      ? getInstallmentOverview(userContext, { includeDeleted: true })
      : getInstallmentOverview(userContext),
    getTransactionFormOptions({ userContext }),
    listSinkingFunds(userContext),
  ]);
  const items =
    view === "deleted"
      ? allItems.filter((item) => Boolean(item.archivedAt))
      : allItems;

  return (
    <AppShell userContext={userContext}>
      <InstallmentsScreen
        categories={formOptions.categories}
        deleteInstallmentAction={deleteInstallmentAction}
        items={items}
        previewDeleteInstallmentAction={previewDeleteInstallmentAction}
        restoreInstallmentAction={restoreInstallmentAction}
        saveAllocationAction={saveInstallmentRetirementAllocationAction}
        sinkingFunds={sinkingFunds}
        view={view}
      />
    </AppShell>
  );
}
