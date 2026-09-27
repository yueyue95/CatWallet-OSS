import { FunMoneyScreen } from "@/components/catwallet/fun-money-screen";
import { setFunMoneyBudgetAction } from "@/app/catwallet/actions";
import { AppShell } from "@/components/dashboard/app-shell";
import { getFunMoneyOverview } from "@/lib/finance/catwallet";

function currentMonth() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

export default async function FunMoneyPage() {
  const overview = await getFunMoneyOverview(currentMonth());

  return (
    <AppShell>
      <FunMoneyScreen
        overview={overview}
        saveBudgetAction={setFunMoneyBudgetAction}
      />
    </AppShell>
  );
}
