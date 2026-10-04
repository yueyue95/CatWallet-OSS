"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { HandCoins } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Transaction } from "@/lib/data";
import type {
  CreateReimbursementInput,
  TransactionFormPaymentMethod,
} from "@/lib/finance/transactions";
import { useI18n } from "@/lib/i18n";

type ReimbursementDialogProps = {
  readonly createAction: (
    input: CreateReimbursementInput,
  ) => Promise<{ transactionId: string }>;
  readonly paymentMethods: TransactionFormPaymentMethod[];
  readonly transactions: Transaction[];
};

function useReimbursementFields() {
  const [open, setOpen] = useState(false);
  const [originalTransactionId, setOriginalTransactionId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [payer, setPayer] = useState("");
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  return {
    amount,
    date,
    error,
    notes,
    open,
    originalTransactionId,
    payer,
    paymentMethod,
    search,
    setAmount,
    setDate,
    setError,
    setNotes,
    setOpen,
    setOriginalTransactionId,
    setPayer,
    setPaymentMethod,
    setSearch,
  };
}

type ReimbursementFields = ReturnType<typeof useReimbursementFields>;

function getReimbursementSelection(
  transactions: Transaction[],
  originalTransactionId: string,
) {
  const selectedExpense = transactions.find(
    (transaction) => transaction.id === originalTransactionId,
  );
  const reimbursedAmount = transactions
    .filter(
      (transaction) =>
        transaction.entryKind === "reimbursement" &&
        transaction.relatedTransactionId === originalTransactionId,
    )
    .reduce((total, transaction) => total + Math.abs(transaction.amount), 0);
  const remainingAmount = Math.max(
    0,
    Math.abs(selectedExpense?.amount ?? 0) - reimbursedAmount,
  );
  return { reimbursedAmount, remainingAmount, selectedExpense };
}

function validateReimbursement(
  fields: ReimbursementFields,
  remainingAmount: number,
  t: (key: string) => string,
) {
  const numericAmount = Number(fields.amount);
  if (
    !fields.originalTransactionId ||
    !fields.paymentMethod ||
    numericAmount <= 0
  ) {
    return t("reimbursements.invalid");
  }
  return numericAmount - remainingAmount > 0.00001
    ? t("reimbursements.exceedsRemaining")
    : null;
}

function resetReimbursementFields(fields: ReimbursementFields) {
  fields.setOpen(false);
  fields.setAmount("");
  fields.setNotes("");
  fields.setPayer("");
  fields.setSearch("");
}

function useReimbursementSubmission({
  createAction,
  fields,
  remainingAmount,
}: {
  createAction: ReimbursementDialogProps["createAction"];
  fields: ReimbursementFields;
  remainingAmount: number;
}) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const submit = () => {
    const validationError = validateReimbursement(fields, remainingAmount, t);
    if (validationError) {
      fields.setError(validationError);
      toast.error(validationError);
      return;
    }
    if (submitting.current) return;
    submitting.current = true;
    fields.setError(null);
    startTransition(async () => {
      try {
        await createAction({
          amount: Number(fields.amount),
          date: fields.date,
          description:
            fields.payer.trim() || t("reimbursements.defaultDescription"),
          idempotencyKey: idempotencyKey.current,
          notes: fields.notes.trim() || undefined,
          originalTransactionId: fields.originalTransactionId,
          paymentMethod: fields.paymentMethod,
        });
        resetReimbursementFields(fields);
        idempotencyKey.current = crypto.randomUUID();
        toast.success(t("reimbursements.saved"));
      } catch {
        const message = t("reimbursements.saveError");
        fields.setError(message);
        toast.error(message);
      } finally {
        submitting.current = false;
      }
    });
  };
  return { pending, submit };
}

function useReimbursementController(props: ReimbursementDialogProps) {
  const fields = useReimbursementFields();
  const selection = getReimbursementSelection(
    props.transactions,
    fields.originalTransactionId,
  );
  const submission = useReimbursementSubmission({
    createAction: props.createAction,
    fields,
    remainingAmount: selection.remainingAmount,
  });
  return { ...fields, ...selection, ...submission };
}

type Controller = ReturnType<typeof useReimbursementController>;

function matchesExpenseSearch(
  transaction: Transaction,
  query: string,
  t: (key: string) => string,
) {
  const searchable = [
    transaction.date,
    t(transaction.descriptionKey),
    Math.abs(transaction.amount).toFixed(2),
    transaction.paymentMethodKey ? t(transaction.paymentMethodKey) : "",
  ]
    .join(" ")
    .toLocaleLowerCase();
  return query.split(/\s+/).every((term) => searchable.includes(term));
}

function isExpenseOption(
  transaction: Transaction,
  query: string,
  t: (key: string) => string,
) {
  const eligible =
    transaction.type === "expense" &&
    transaction.entryKind !== "repayment" &&
    transaction.entryKind !== "transfer" &&
    !transaction.isCreditCardInvoice;
  return eligible && (!query || matchesExpenseSearch(transaction, query, t));
}

function ExpenseOption({ transaction }: { transaction: Transaction }) {
  const { formatCurrency, t } = useI18n();
  return (
    <SelectItem value={transaction.id}>
      {t(transaction.descriptionKey)} ·{" "}
      {formatCurrency(Math.abs(transaction.amount))} · {transaction.date} ·{" "}
      {transaction.paymentMethodKey ? t(transaction.paymentMethodKey) : "—"}
    </SelectItem>
  );
}

function ExpenseSelect({
  controller,
  transactions,
}: {
  controller: Controller;
  transactions: Transaction[];
}) {
  const { t } = useI18n();
  const query = controller.search.trim().toLocaleLowerCase();
  const expenses = useMemo(
    () =>
      transactions.filter((transaction) =>
        isExpenseOption(transaction, query, t),
      ),
    [query, t, transactions],
  );
  return (
    <>
      <Label htmlFor="reimbursement-expense-search">
        {t("reimbursements.searchExpense")}
      </Label>
      <Input
        id="reimbursement-expense-search"
        value={controller.search}
        onChange={(event) => controller.setSearch(event.target.value)}
      />
      <Label htmlFor="reimbursement-original-expense">
        {t("reimbursements.originalExpense")}
      </Label>
      <Select
        value={controller.originalTransactionId}
        onValueChange={(value) => {
          controller.setError(null);
          controller.setOriginalTransactionId(value);
        }}
      >
        <SelectTrigger id="reimbursement-original-expense">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {expenses.map((transaction) => (
            <ExpenseOption key={transaction.id} transaction={transaction} />
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

function SelectedExpenseSummary({ controller }: { controller: Controller }) {
  const { formatCurrency, t } = useI18n();
  const expense = controller.selectedExpense;
  if (!expense) return null;
  return (
    <dl className="grid gap-2 rounded-lg border bg-muted/20 p-3 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-muted-foreground">
          {t("reimbursements.grossExpense")}
        </dt>
        <dd>{formatCurrency(Math.abs(expense.amount))}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">
          {t("reimbursements.reimbursed")}
        </dt>
        <dd>{formatCurrency(controller.reimbursedAmount)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">
          {t("reimbursements.remaining")}
        </dt>
        <dd>{formatCurrency(controller.remainingAmount)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">
          {t("reimbursements.originalAccount")}
        </dt>
        <dd>{expense.paymentMethodKey ? t(expense.paymentMethodKey) : "—"}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">
          {t("reimbursements.purchaseDate")}
        </dt>
        <dd>{expense.date}</dd>
      </div>
    </dl>
  );
}

function ReceivingAccountSelect({
  controller,
  paymentMethods,
}: {
  controller: Controller;
  paymentMethods: TransactionFormPaymentMethod[];
}) {
  const { t } = useI18n();
  const accounts = paymentMethods.filter(
    (account) => account.id !== "none" && account.type !== "credit",
  );
  return (
    <>
      <Label htmlFor="reimbursement-receiving-account">
        {t("reimbursements.receivingAccount")}
      </Label>
      <Select
        value={controller.paymentMethod}
        onValueChange={controller.setPaymentMethod}
      >
        <SelectTrigger id="reimbursement-receiving-account">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((account) => (
            <SelectItem key={account.id} value={account.id}>
              {t(account.label)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

function ReimbursementValueFields({ controller }: { controller: Controller }) {
  const { t } = useI18n();
  return (
    <>
      <Label htmlFor="reimbursement-amount">{t("transaction.amount")}</Label>
      <Input
        id="reimbursement-amount"
        min="0.01"
        step="0.01"
        type="number"
        value={controller.amount}
        onChange={(event) => {
          controller.setError(null);
          controller.setAmount(event.target.value);
        }}
      />
      <Label htmlFor="reimbursement-date">{t("transaction.date")}</Label>
      <Input
        id="reimbursement-date"
        type="date"
        value={controller.date}
        onChange={(event) => controller.setDate(event.target.value)}
      />
      <Label htmlFor="reimbursement-payer">{t("reimbursements.payer")}</Label>
      <Input
        id="reimbursement-payer"
        value={controller.payer}
        onChange={(event) => controller.setPayer(event.target.value)}
      />
      <Label htmlFor="reimbursement-notes">{t("transaction.notes")}</Label>
      <Input
        id="reimbursement-notes"
        value={controller.notes}
        onChange={(event) => controller.setNotes(event.target.value)}
      />
    </>
  );
}

function ReimbursementImpactPreview({
  controller,
  paymentMethods,
}: {
  controller: Controller;
  paymentMethods: TransactionFormPaymentMethod[];
}) {
  const { formatCurrency, t } = useI18n();
  const amount = Number(controller.amount);
  if (!controller.selectedExpense || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  const account = paymentMethods.find(
    (candidate) => candidate.id === controller.paymentMethod,
  );
  return (
    <section className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
      <h3 className="font-medium">{t("reimbursements.impactTitle")}</h3>
      <ul className="mt-2 space-y-1 text-muted-foreground">
        <li>{t("reimbursements.grossUnchanged")}</li>
        <li>
          {t("reimbursements.reimbursementIncrease").replace(
            "{amount}",
            formatCurrency(amount),
          )}
        </li>
        <li>
          {t("reimbursements.personalExpenseDecrease").replace(
            "{amount}",
            formatCurrency(amount),
          )}
        </li>
        <li>{t("reimbursements.noOrdinaryIncome")}</li>
        <li>
          {t("reimbursements.accountIncrease")
            .replace("{account}", account ? t(account.label) : "—")
            .replace("{amount}", formatCurrency(amount))}
        </li>
      </ul>
    </section>
  );
}

function ReimbursementForm({
  controller,
  paymentMethods,
  transactions,
}: {
  controller: Controller;
  paymentMethods: TransactionFormPaymentMethod[];
  transactions: Transaction[];
}) {
  return (
    <div className="grid gap-3">
      <ExpenseSelect controller={controller} transactions={transactions} />
      <SelectedExpenseSummary controller={controller} />
      <ReceivingAccountSelect
        controller={controller}
        paymentMethods={paymentMethods}
      />
      <ReimbursementValueFields controller={controller} />
      <ReimbursementImpactPreview
        controller={controller}
        paymentMethods={paymentMethods}
      />
      {controller.error ? (
        <p role="alert" className="text-sm text-destructive">
          {controller.error}
        </p>
      ) : null}
    </div>
  );
}

export function ReimbursementDialog(props: ReimbursementDialogProps) {
  const { t } = useI18n();
  const controller = useReimbursementController(props);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => controller.setOpen(true)}
      >
        <HandCoins className="mr-2 size-4" />
        {t("reimbursements.add")}
      </Button>
      <Dialog open={controller.open} onOpenChange={controller.setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("reimbursements.add")}</DialogTitle>
            <DialogDescription>
              {t("reimbursements.description")}
            </DialogDescription>
          </DialogHeader>
          <ReimbursementForm
            controller={controller}
            paymentMethods={props.paymentMethods}
            transactions={props.transactions}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => controller.setOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={controller.pending}
              onClick={controller.submit}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
