import { redirect } from "next/navigation";
import { TransactionForm } from "@/components/dashboard/transaction-form";
import { ReimbursementDialog } from "@/components/dashboard/reimbursement-dialog";
import { AppShell } from "@/components/dashboard/app-shell";
import { createClient } from "@/lib/supabase/server";
import {
  createCategoryAction,
  createReimbursementAction,
  createTransactionAction,
} from "@/app/transactions/actions";
import {
  getTransactionFormOptions,
  getUserContext,
  listTransactions,
} from "@/lib/finance/transactions";
import { getCoolingItem } from "@/lib/finance/cooling";
import { listFixedCommitments } from "@/lib/finance/catwallet";

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

async function getNewTransactionPageData(
  userContext: Awaited<ReturnType<typeof getUserContext>>,
  coolingItemId: string | undefined,
) {
  return Promise.all([
    getTransactionFormOptions({ userContext }),
    coolingItemId ? getCoolingItem(coolingItemId, userContext) : null,
    listFixedCommitments(userContext),
    listTransactions({ includePrevious: true, userContext }),
  ]);
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
  const [formOptions, coolingItem, fixedCommitments, transactions] =
    await getNewTransactionPageData(userContext, coolingItemId);

  return (
    <AppShell userContext={userContext}>
      <div className="mb-4 flex justify-end">
        <ReimbursementDialog
          createAction={createReimbursementAction}
          paymentMethods={formOptions.paymentMethods}
          transactions={transactions}
        />
      </div>
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
        fixedCommitments={fixedCommitments.map(({ amount, id, name }) => ({
          amount,
          id,
          name,
        }))}
        onSubmit={createTransactionAction}
        paymentMethods={formOptions.paymentMethods}
        successRedirect="/dashboard"
      />
    </AppShell>
  );
}
