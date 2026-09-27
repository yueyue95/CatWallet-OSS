import { AppShell } from "@/components/dashboard/app-shell";
import { CoolingScreen } from "@/components/catwallet/cooling-screen";
import {
  abandonCoolingItemAction,
  createCoolingItemAction,
} from "@/app/cooling/actions";
import { listCoolingItems } from "@/lib/finance/cooling";

export default async function CoolingPage() {
  const items = await listCoolingItems();

  return (
    <AppShell>
      <CoolingScreen
        abandonAction={abandonCoolingItemAction}
        createAction={createCoolingItemAction}
        items={items}
      />
    </AppShell>
  );
}
