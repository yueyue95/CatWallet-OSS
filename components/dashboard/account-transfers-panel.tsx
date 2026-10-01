"use client";

import { useState, useTransition } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ArrowRightLeft, Pencil, RotateCcw, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import type {
  AccountTransfer,
  CreateAccountTransferInput,
  TransactionFormPaymentMethod,
  UpdateAccountTransferInput,
} from "@/lib/finance/transactions";
import { useI18n } from "@/lib/i18n";

type TransferForm = {
  amount: string;
  date: string;
  description: string;
  destinationAccountId: string;
  notes: string;
  sourceAccountId: string;
};

type AccountTransfersPanelProps = {
  readonly createAction: (
    input: CreateAccountTransferInput,
  ) => Promise<{ revision: number; transferId: string }>;
  readonly deleteAction: (input: {
    expectedRevision: number;
    id: string;
  }) => Promise<number>;
  readonly paymentMethods: TransactionFormPaymentMethod[];
  readonly restoreAction: (input: {
    expectedRevision: number;
    id: string;
  }) => Promise<number>;
  readonly transfers: AccountTransfer[];
  readonly updateAction: (input: UpdateAccountTransferInput) => Promise<number>;
};

function newForm(): TransferForm {
  return {
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    description: "",
    destinationAccountId: "",
    notes: "",
    sourceAccountId: "",
  };
}

function transferForm(transfer: AccountTransfer): TransferForm {
  return {
    amount: String(transfer.amount),
    date: transfer.transferDate,
    description: transfer.description,
    destinationAccountId: transfer.destinationAccountId,
    notes: transfer.notes ?? "",
    sourceAccountId: transfer.sourceAccountId,
  };
}

function parseTransferForm(form: TransferForm) {
  const amount = Number(form.amount);
  const valid =
    Number.isFinite(amount) &&
    amount > 0 &&
    form.sourceAccountId &&
    form.destinationAccountId &&
    form.sourceAccountId !== form.destinationAccountId &&
    form.description.trim();
  return valid ? { ...form, amount } : null;
}

function transferAccounts(paymentMethods: TransactionFormPaymentMethod[]) {
  return paymentMethods.filter(
    (account) => account.type !== "credit" && account.id !== "none",
  );
}

function transferFieldType(field: "amount" | "date" | "description") {
  if (field === "amount") return "number";
  if (field === "date") return "date";
  return "text";
}

async function saveTransfer(
  props: AccountTransfersPanelProps,
  editing: AccountTransfer | null,
  input: NonNullable<ReturnType<typeof parseTransferForm>>,
) {
  if (editing) {
    await props.updateAction({
      ...input,
      expectedRevision: editing.revision,
      id: editing.id,
    });
    return;
  }
  await props.createAction({ ...input, idempotencyKey: crypto.randomUUID() });
}

function useTransferController(props: AccountTransfersPanelProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AccountTransfer | null>(null);
  const [form, setForm] = useState<TransferForm>(newForm);
  const [pending, startTransition] = useTransition();
  const accounts = transferAccounts(props.paymentMethods);
  const openForm = (transfer: AccountTransfer | null) => {
    setEditing(transfer);
    setForm(transfer ? transferForm(transfer) : newForm());
    setOpen(true);
  };
  const submit = () => {
    const input = parseTransferForm(form);
    if (!input) return toast.error(t("transfers.invalid"));
    startTransition(async () => {
      try {
        await saveTransfer(props, editing, input);
        setOpen(false);
        toast.success(t("transfers.saved"));
      } catch {
        toast.error(t("transfers.saveError"));
      }
    });
  };
  const changeLifecycle = (transfer: AccountTransfer) => {
    startTransition(async () => {
      try {
        const restore = Boolean(transfer.deletedAt);
        const action = restore ? props.restoreAction : props.deleteAction;
        await action({ expectedRevision: transfer.revision, id: transfer.id });
        toast.success(t(restore ? "transfers.restored" : "transfers.deleted"));
      } catch {
        toast.error(t("transfers.lifecycleError"));
      }
    });
  };
  return {
    accounts,
    changeLifecycle,
    editing,
    form,
    open,
    openForm,
    pending,
    setForm,
    setOpen,
    submit,
  };
}

type TransferFieldsProps = {
  accounts: TransactionFormPaymentMethod[];
  form: TransferForm;
  setForm: Dispatch<SetStateAction<TransferForm>>;
};

function TransferAccountFields({
  accounts,
  form,
  setForm,
}: TransferFieldsProps) {
  const { t } = useI18n();
  const accountSelect = (field: "sourceAccountId" | "destinationAccountId") => (
    <Select
      value={form[field]}
      onValueChange={(value) => setForm({ ...form, [field]: value })}
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
  );
  return (
    <>
      <Label>{t("transfers.source")}</Label>
      {accountSelect("sourceAccountId")}
      <Label>{t("transfers.destination")}</Label>
      {accountSelect("destinationAccountId")}
    </>
  );
}

function TransferDetailFields({
  form,
  setForm,
}: Omit<TransferFieldsProps, "accounts">) {
  const { t } = useI18n();
  const input = (field: "amount" | "date" | "description") => (
    <Input
      id={`transfer-${field}`}
      min={field === "amount" ? "0.01" : undefined}
      step={field === "amount" ? "0.01" : undefined}
      type={transferFieldType(field)}
      value={form[field]}
      onChange={(event) => setForm({ ...form, [field]: event.target.value })}
    />
  );
  return (
    <>
      <Label htmlFor="transfer-amount">{t("transaction.amount")}</Label>
      {input("amount")}
      <Label htmlFor="transfer-date">{t("transaction.date")}</Label>
      {input("date")}
      <Label htmlFor="transfer-description">
        {t("transaction.description")}
      </Label>
      {input("description")}
      <Label htmlFor="transfer-notes">{t("transaction.notes")}</Label>
      <Textarea
        id="transfer-notes"
        value={form.notes}
        onChange={(event) => setForm({ ...form, notes: event.target.value })}
      />
    </>
  );
}

function TransferFormDialog({
  controller,
}: {
  controller: ReturnType<typeof useTransferController>;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={controller.open} onOpenChange={controller.setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(controller.editing ? "transfers.edit" : "transfers.add")}
          </DialogTitle>
          <DialogDescription>
            {t("transfers.formDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <TransferAccountFields
            accounts={controller.accounts}
            form={controller.form}
            setForm={controller.setForm}
          />
          <TransferDetailFields
            form={controller.form}
            setForm={controller.setForm}
          />
        </div>
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
  );
}

type TransferRowProps = {
  accountName: (id: string) => string;
  controller: ReturnType<typeof useTransferController>;
  transfer: AccountTransfer;
};

function TransferRow({ accountName, controller, transfer }: TransferRowProps) {
  const { formatCurrency, t } = useI18n();
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-3 py-2 text-sm">
      <div className={transfer.deletedAt ? "opacity-60" : undefined}>
        <div className="font-medium">{transfer.description}</div>
        <div className="text-muted-foreground">
          {accountName(transfer.sourceAccountId)} →{" "}
          {accountName(transfer.destinationAccountId)} ·{" "}
          {formatCurrency(transfer.amount)} · {transfer.transferDate}
        </div>
      </div>
      <div className="flex gap-1">
        {!transfer.deletedAt && (
          <Button
            aria-label={t("common.edit")}
            disabled={controller.pending}
            onClick={() => controller.openForm(transfer)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Pencil className="size-4" />
          </Button>
        )}
        <Button
          aria-label={t(
            transfer.deletedAt ? "transfers.restore" : "common.delete",
          )}
          disabled={controller.pending}
          onClick={() => controller.changeLifecycle(transfer)}
          size="icon"
          type="button"
          variant="ghost"
        >
          {transfer.deletedAt ? (
            <RotateCcw className="size-4" />
          ) : (
            <Trash2 className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

export function AccountTransfersPanel(props: AccountTransfersPanelProps) {
  const { t } = useI18n();
  const controller = useTransferController(props);
  const accountName = (id: string) =>
    controller.accounts.find((account) => account.id === id)?.label ?? id;
  return (
    <section className="mb-4 rounded-xl border border-border/50 bg-card/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">{t("transfers.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("transfers.description")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => controller.openForm(null)}
        >
          <ArrowRightLeft className="mr-2 size-4" />
          {t("transfers.add")}
        </Button>
      </div>
      {props.transfers.length > 0 && (
        <div className="mt-3 space-y-2">
          {props.transfers.map((transfer) => (
            <TransferRow
              accountName={accountName}
              controller={controller}
              key={transfer.id}
              transfer={transfer}
            />
          ))}
        </div>
      )}
      <TransferFormDialog controller={controller} />
    </section>
  );
}
