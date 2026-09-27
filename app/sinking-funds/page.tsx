import { SinkingFundsScreen } from "@/components/catwallet/sinking-funds-screen";
import {
  createSinkingFundAction,
  deleteSinkingFundAction,
  updateSinkingFundAction,
} from "@/app/catwallet/actions";
import { AppShell } from "@/components/dashboard/app-shell";
import { listSinkingFunds } from "@/lib/finance/catwallet";

export default async function SinkingFundsPage() {
  const funds = await listSinkingFunds();

  return (
    <AppShell>
      <SinkingFundsScreen
        createAction={createSinkingFundAction}
        deleteAction={deleteSinkingFundAction}
        funds={funds}
        updateAction={updateSinkingFundAction}
      />
    </AppShell>
  );
}
