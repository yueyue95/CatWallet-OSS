import { CommitmentsScreen } from "@/components/catwallet/commitments-screen";
import {
  createFixedCommitmentAction,
  deleteFixedCommitmentAction,
  recordFixedCommitmentPaymentAction,
  updateFixedCommitmentAction,
} from "@/app/catwallet/actions";
import { AppShell } from "@/components/dashboard/app-shell";
import { listFixedCommitments } from "@/lib/finance/catwallet";
import {
  getTransactionFormOptions,
  getUserContext,
} from "@/lib/finance/transactions";

export default async function CommitmentsPage() {
  const userContext = await getUserContext();
  const [commitments, formOptions] = await Promise.all([
    listFixedCommitments(userContext),
    getTransactionFormOptions({ userContext }),
  ]);

  return (
    <AppShell userContext={userContext}>
      <CommitmentsScreen
        categories={formOptions.categories}
        commitments={commitments}
        createAction={createFixedCommitmentAction}
        deleteAction={deleteFixedCommitmentAction}
        paymentMethods={formOptions.paymentMethods}
        recordPaymentAction={recordFixedCommitmentPaymentAction}
        updateAction={updateFixedCommitmentAction}
      />
    </AppShell>
  );
}
