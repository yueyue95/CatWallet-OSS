import { redirect } from "next/navigation";
import { TransactionForm } from "@/components/dashboard/transaction-form";
import { AppShell } from "@/components/dashboard/app-shell";
import { createClient } from "@/lib/supabase/server";
import {
  createCategoryAction,
  createTransactionAction,
} from "@/app/transactions/actions";
import {
  getTransactionFormOptions,
  getUserContext,
} from "@/lib/finance/transactions";
import { getCoolingItem } from "@/lib/finance/cooling";

type NewTransactionPageProps = {
  readonly searchParams?: Promise<{
    coolingItem?: string | string[];
  }>;
};

function resolveCoolingItemId(value: string | string[] | undefined) {
  const id = Array.isArray(value) ? value[0] : value;
  return id &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
    ? id
    : undefined;
}

export default async function NewTransactionPage({
  searchParams,
}: NewTransactionPageProps) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims?.sub) {
    redirect("/");
  }

  const userContext = await getUserContext(supabase);
  const resolvedSearchParams = await searchParams;
  const coolingItemId = resolveCoolingItemId(resolvedSearchParams?.coolingItem);
  const [formOptions, coolingItem] = await Promise.all([
    getTransactionFormOptions({ userContext }),
    coolingItemId ? getCoolingItem(coolingItemId, userContext) : null,
  ]);

  return (
    <AppShell userContext={userContext}>
      <TransactionForm
        categories={formOptions.categories}
        coolingItem={
          coolingItem
            ? {
                amountCents: coolingItem.amountCents,
                id: coolingItem.id,
                name: coolingItem.name,
              }
            : undefined
        }
        createCategoryAction={createCategoryAction}
        onSubmit={createTransactionAction}
        paymentMethods={formOptions.paymentMethods}
        successRedirect="/dashboard"
      />
    </AppShell>
  );
}
