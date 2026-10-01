"use client";

import { useState, useTransition } from "react";
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

function useReimbursementController({
  createAction,
}: ReimbursementDialogProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [originalTransactionId, setOriginalTransactionId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const submit = () => {
    const numericAmount = Number(amount);
    if (!originalTransactionId || !paymentMethod || numericAmount <= 0) {
      toast.error(t("reimbursements.invalid"));
      return;
    }
    startTransition(async () => {
      try {
        await createAction({
          amount: numericAmount,
          date,
          description: t("reimbursements.defaultDescription"),
          idempotencyKey: crypto.randomUUID(),
          originalTransactionId,
          paymentMethod,
        });
        setOpen(false);
        setAmount("");
        toast.success(t("reimbursements.saved"));
      } catch {
        toast.error(t("reimbursements.saveError"));
      }
    });
  };
  return {
    amount,
    date,
    open,
    originalTransactionId,
    paymentMethod,
    pending,
    setAmount,
    setDate,
    setOpen,
    setOriginalTransactionId,
    setPaymentMethod,
    submit,
  };
}

type Controller = ReturnType<typeof useReimbursementController>;

function ExpenseSelect({
  controller,
  transactions,
}: {
  controller: Controller;
  transactions: Transaction[];
}) {
  const { formatCurrency, t } = useI18n();
  const expenses = transactions.filter(
    (transaction) =>
      transaction.type === "expense" &&
      transaction.entryKind !== "repayment" &&
      transaction.entryKind !== "transfer" &&
      !transaction.isCreditCardInvoice,
  );
  return (
    <>
      <Label>{t("reimbursements.originalExpense")}</Label>
      <Select
        value={controller.originalTransactionId}
        onValueChange={controller.setOriginalTransactionId}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {expenses.map((transaction) => (
            <SelectItem key={transaction.id} value={transaction.id}>
              {t(transaction.descriptionKey)} ·{" "}
              {formatCurrency(Math.abs(transaction.amount))}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
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
      <Label>{t("reimbursements.receivingAccount")}</Label>
      <Select
        value={controller.paymentMethod}
        onValueChange={controller.setPaymentMethod}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((account) => (
            <SelectItem key={account.id} value={account.id}>
              {account.label}
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
        onChange={(event) => controller.setAmount(event.target.value)}
      />
      <Label htmlFor="reimbursement-date">{t("transaction.date")}</Label>
      <Input
        id="reimbursement-date"
        type="date"
        value={controller.date}
        onChange={(event) => controller.setDate(event.target.value)}
      />
    </>
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
      <ReceivingAccountSelect
        controller={controller}
        paymentMethods={paymentMethods}
      />
      <ReimbursementValueFields controller={controller} />
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
        <DialogContent>
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
