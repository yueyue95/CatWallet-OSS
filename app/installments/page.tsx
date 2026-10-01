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

export default async function InstallmentsPage() {
  const userContext = await getUserContext();
  const [items, formOptions, sinkingFunds] = await Promise.all([
    getInstallmentOverview(userContext, { includeDeleted: true }),
    getTransactionFormOptions({ userContext }),
    listSinkingFunds(userContext),
  ]);

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
      />
    </AppShell>
  );
}
