"use client";

import { useMemo, useState, useTransition } from "react";
import { CalendarClock, Check, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/dashboard/page-header";
import { useI18n } from "@/lib/i18n";
import type {
  FixedCommitment,
  FixedCommitmentInput,
} from "@/lib/finance/catwallet";
import type {
  TransactionFormCategory,
  TransactionFormPaymentMethod,
} from "@/lib/finance/transactions";

type CreateCommitmentAction = (data: FixedCommitmentInput) => Promise<void>;
type UpdateCommitmentAction = (
  data: FixedCommitmentInput & { id: string },
) => Promise<void>;

type CommitmentsScreenProps = {
  categories: TransactionFormCategory[];
  commitments: FixedCommitment[];
  createAction: CreateCommitmentAction;
  deleteAction: (id: string) => Promise<void>;
  paymentMethods: TransactionFormPaymentMethod[];
  recordPaymentAction: (data: {
    amount: number;
    commitmentId: string;
    date: string;
    description: string;
    notes?: string | null;
  }) => Promise<void>;
  updateAction: UpdateCommitmentAction;
};

type CommitmentForm = Omit<
  FixedCommitmentInput,
  "categoryId" | "paymentMethodId"
> & { categoryId: string; paymentMethodId: string };
const today = new Date().toISOString().slice(0, 10);

function emptyForm(): CommitmentForm {
  return {
    amount: 0,
    cadence: "monthly",
    categoryId: "",
    customIntervalMonths: null,
    endDate: null,
    includeInSafeToSpend: true,
    isEnabled: true,
    name: "",
    paymentMethodId: "",
    startDate: today,
  };
}

function toForm(commitment: FixedCommitment): CommitmentForm {
  return {
    amount: commitment.amount,
    cadence: commitment.cadence,
    categoryId: commitment.categoryId ?? "",
    customIntervalMonths: commitment.customIntervalMonths,
    endDate: commitment.endDate,
    includeInSafeToSpend: commitment.includeInSafeToSpend,
    isEnabled: commitment.isEnabled,
    name: commitment.name,
    paymentMethodId: commitment.paymentMethodId ?? "",
    startDate: commitment.startDate,
  };
}

export function CommitmentsScreen({
  categories,
  commitments,
  createAction,
  deleteAction,
  paymentMethods,
  recordPaymentAction,
  updateAction,
}: CommitmentsScreenProps) {
  const { formatCurrency, t } = useI18n();
  const router = useRouter();
  const [form, setForm] = useState<CommitmentForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [recordAmount, setRecordAmount] = useState("");
  const [recordDescription, setRecordDescription] = useState("");
  const [recordDate, setRecordDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const selectableCategories = useMemo(
    () =>
      categories.filter(
        (category) => category.group !== "income" && category.id !== "none",
      ),
    [categories],
  );

  function updateField<K extends keyof CommitmentForm>(
    key: K,
    value: CommitmentForm[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submitForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!form.paymentMethodId || !form.categoryId) {
      setError(t("catwallet.commitmentSelectionsRequired"));
      return;
    }
    const input: FixedCommitmentInput = {
      ...form,
      endDate: form.endDate || null,
    };
    startTransition(async () => {
      try {
        if (editingId) await updateAction({ ...input, id: editingId });
        else await createAction(input);
        setForm(emptyForm());
        setEditingId(null);
        router.refresh();
      } catch {
        setError(t("common.saveError"));
      }
    });
  }

  function removeCommitment(id: string) {
    if (!window.confirm(`${t("common.delete")}？`)) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteAction(id);
        if (editingId === id) {
          setEditingId(null);
          setForm(emptyForm());
        }
        router.refresh();
      } catch {
        setError(t("common.deleteError"));
      }
    });
  }

  function recordPayment(
    event: React.FormEvent<HTMLFormElement>,
    commitmentId: string,
  ) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await recordPaymentAction({
          amount: Number(recordAmount),
          commitmentId,
          date: recordDate,
          description: recordDescription || t("catwallet.fixedCommitments"),
        });
        setRecordingId(null);
        setRecordAmount("");
        setRecordDescription("");
        router.refresh();
      } catch {
        setError(t("common.paymentError"));
      }
    });
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title={t("catwallet.fixedCommitmentsTitle")}
        description={t("catwallet.fixedCommitmentsDescription")}
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="size-5 text-primary" aria-hidden="true" />
            {editingId
              ? t("common.edit")
              : t("catwallet.fixedCommitmentsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={submitForm}>
            <Field label={t("common.name")}>
              <Input
                required
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
              />
            </Field>
            <Field label={t("common.amount")}>
              <Input
                required
                min="0.01"
                step="0.01"
                type="number"
                value={form.amount || ""}
                onChange={(event) =>
                  updateField("amount", Number(event.target.value))
                }
              />
            </Field>
            <Field label={t("catwallet.cadence")}>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.cadence}
                onChange={(event) =>
                  updateField(
                    "cadence",
                    event.target.value as CommitmentForm["cadence"],
                  )
                }
              >
                <option value="monthly">{t("catwallet.monthly")}</option>
                <option value="yearly">{t("catwallet.yearly")}</option>
                <option value="custom">{t("catwallet.custom")}</option>
              </select>
            </Field>
            {form.cadence === "custom" ? (
              <Field label={t("catwallet.custom")}>
                <Input
                  required
                  min="1"
                  max="120"
                  type="number"
                  value={form.customIntervalMonths ?? ""}
                  onChange={(event) =>
                    updateField(
                      "customIntervalMonths",
                      Number(event.target.value),
                    )
                  }
                />
              </Field>
            ) : null}
            <Field label={t("catwallet.startDate")}>
              <Input
                required
                type="date"
                value={form.startDate}
                onChange={(event) =>
                  updateField("startDate", event.target.value)
                }
              />
            </Field>
            <Field label={t("catwallet.endDate")}>
              <Input
                type="date"
                value={form.endDate ?? ""}
                onChange={(event) =>
                  updateField("endDate", event.target.value || null)
                }
              />
            </Field>
            <Field label={t("transaction.paymentMethod")}>
              <select
                required
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.paymentMethodId}
                onChange={(event) =>
                  updateField("paymentMethodId", event.target.value)
                }
              >
                <option value="">{t("catwallet.selectPaymentAccount")}</option>
                {paymentMethods
                  .filter((method) => method.id !== "none")
                  .map((method) => (
                    <option key={method.id} value={method.id}>
                      {t(method.label)}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={t("common.category")}>
              <select
                required
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.categoryId}
                onChange={(event) =>
                  updateField("categoryId", event.target.value)
                }
              >
                <option value="">{t("catwallet.selectCategory")}</option>
                {selectableCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {t(category.label)}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm text-muted-foreground md:col-span-2">
              <input
                checked={form.includeInSafeToSpend}
                type="checkbox"
                onChange={(event) =>
                  updateField("includeInSafeToSpend", event.target.checked)
                }
              />
              {t("catwallet.includeInSafeToSpend")}
            </label>
            {error ? (
              <p className="text-sm text-destructive md:col-span-2">{error}</p>
            ) : null}
            <div className="flex gap-2 md:col-span-2">
              <Button disabled={isPending} type="submit">
                {editingId ? (
                  t("common.update")
                ) : (
                  <>
                    <Plus className="size-4" aria-hidden="true" />
                    {t("common.create")}
                  </>
                )}
              </Button>
              {editingId ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingId(null);
                    setForm(emptyForm());
                  }}
                >
                  {t("common.cancel")}
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {commitments.map((commitment) => (
          <CommitmentCard
            key={commitment.id}
            categories={categories}
            commitment={commitment}
            formatCurrency={formatCurrency}
            isPending={isPending}
            isRecording={recordingId === commitment.id}
            onDelete={() => removeCommitment(commitment.id)}
            onEdit={() => {
              setEditingId(commitment.id);
              setForm(toForm(commitment));
            }}
            onRecord={() => {
              setRecordingId(commitment.id);
              setRecordAmount(String(commitment.amount));
              setRecordDescription(commitment.name);
            }}
            onRecordPayment={(event) => recordPayment(event, commitment.id)}
            paymentMethods={paymentMethods}
            recordAmount={recordAmount}
            recordDate={recordDate}
            recordDescription={recordDescription}
            setRecordAmount={setRecordAmount}
            setRecordDate={setRecordDate}
            setRecordDescription={setRecordDescription}
            t={t}
          />
        ))}
      </div>
      {commitments.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("common.noDataForPeriod")}
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}

type CommitmentCardProps = {
  categories: TransactionFormCategory[];
  commitment: FixedCommitment;
  formatCurrency: (amount: number) => string;
  isPending: boolean;
  isRecording: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onRecord: () => void;
  onRecordPayment: (event: React.FormEvent<HTMLFormElement>) => void;
  paymentMethods: TransactionFormPaymentMethod[];
  recordAmount: string;
  recordDate: string;
  recordDescription: string;
  setRecordAmount: (value: string) => void;
  setRecordDate: (value: string) => void;
  setRecordDescription: (value: string) => void;
  t: (key: string) => string;
};

function CommitmentCard(props: CommitmentCardProps) {
  return (
    <Card>
      <CommitmentCardHeader
        commitment={props.commitment}
        formatCurrency={props.formatCurrency}
        t={props.t}
      />
      <CardContent className="space-y-3 text-sm">
        <CommitmentCardDetails
          categories={props.categories}
          commitment={props.commitment}
          paymentMethods={props.paymentMethods}
          t={props.t}
        />
        <CommitmentCardActions
          onDelete={props.onDelete}
          onEdit={props.onEdit}
          onRecord={props.onRecord}
          t={props.t}
        />
        {props.isRecording ? <CommitmentPaymentForm {...props} /> : null}
      </CardContent>
    </Card>
  );
}

function CommitmentCardHeader({
  commitment,
  formatCurrency,
  t,
}: Pick<CommitmentCardProps, "commitment" | "formatCurrency" | "t">) {
  return (
    <CardHeader className="flex-row items-start justify-between space-y-0">
      <div>
        <CardTitle>{commitment.name}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatCurrency(commitment.amount)} /{" "}
          {t(`catwallet.${commitment.cadence}`)}
        </p>
      </div>
      <span className="text-xl" aria-hidden="true">
        {commitment.isEnabled ? "✅" : "⏸️"}
      </span>
    </CardHeader>
  );
}

function CommitmentCardDetails({
  categories,
  commitment,
  paymentMethods,
  t,
}: Pick<
  CommitmentCardProps,
  "categories" | "commitment" | "paymentMethods" | "t"
>) {
  const category = categories.find((item) => item.id === commitment.categoryId);
  const paymentMethod = paymentMethods.find(
    (item) => item.id === commitment.paymentMethodId,
  );

  return (
    <>
      <p className="text-muted-foreground">
        {commitment.startDate}
        {commitment.endDate ? ` → ${commitment.endDate}` : ""}
      </p>
      <p className="text-muted-foreground">
        {t(category?.label ?? commitment.categoryName ?? "common.category")} ·{" "}
        {t(
          paymentMethod?.label ??
            commitment.paymentMethodName ??
            "transaction.paymentMethod",
        )}
      </p>
    </>
  );
}

function CommitmentCardActions({
  onDelete,
  onEdit,
  onRecord,
  t,
}: Pick<CommitmentCardProps, "onDelete" | "onEdit" | "onRecord" | "t">) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={onEdit}>
        <Pencil className="size-4" aria-hidden="true" />
        {t("common.edit")}
      </Button>
      <Button size="sm" variant="outline" onClick={onRecord}>
        <Check className="size-4" aria-hidden="true" />
        {t("common.complete")}
      </Button>
      <Button size="sm" variant="destructive" onClick={onDelete}>
        <Trash2 className="size-4" aria-hidden="true" />
        {t("common.delete")}
      </Button>
    </div>
  );
}

function CommitmentPaymentForm({
  isPending,
  onRecordPayment,
  recordAmount,
  recordDate,
  recordDescription,
  setRecordAmount,
  setRecordDate,
  setRecordDescription,
  t,
}: Pick<
  CommitmentCardProps,
  | "isPending"
  | "onRecordPayment"
  | "recordAmount"
  | "recordDate"
  | "recordDescription"
  | "setRecordAmount"
  | "setRecordDate"
  | "setRecordDescription"
  | "t"
>) {
  return (
    <form
      className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-3"
      onSubmit={onRecordPayment}
    >
      <CommitmentPaymentFields
        recordAmount={recordAmount}
        recordDate={recordDate}
        recordDescription={recordDescription}
        setRecordAmount={setRecordAmount}
        setRecordDate={setRecordDate}
        setRecordDescription={setRecordDescription}
        t={t}
      />
      <Button
        className="sm:col-span-3"
        disabled={isPending}
        size="sm"
        type="submit"
      >
        {t("transaction.save")}
      </Button>
    </form>
  );
}

function CommitmentPaymentFields({
  recordAmount,
  recordDate,
  recordDescription,
  setRecordAmount,
  setRecordDate,
  setRecordDescription,
  t,
}: Pick<
  CommitmentCardProps,
  | "recordAmount"
  | "recordDate"
  | "recordDescription"
  | "setRecordAmount"
  | "setRecordDate"
  | "setRecordDescription"
  | "t"
>) {
  return (
    <>
      <Input
        required
        min="0.01"
        step="0.01"
        type="number"
        value={recordAmount}
        onChange={(event) => setRecordAmount(event.target.value)}
        aria-label={t("common.amount")}
      />
      <Input
        required
        value={recordDescription}
        onChange={(event) => setRecordDescription(event.target.value)}
        aria-label={t("transaction.description")}
      />
      <Input
        required
        type="date"
        value={recordDate}
        onChange={(event) => setRecordDate(event.target.value)}
        aria-label={t("transaction.date")}
      />
    </>
  );
}

function Field({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
