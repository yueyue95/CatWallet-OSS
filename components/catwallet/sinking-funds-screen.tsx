"use client";

import { useState, useTransition } from "react";
import { Pencil, PiggyBank, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/dashboard/page-header";
import { useI18n } from "@/lib/i18n";
import type {
  SinkingFund,
  SinkingFundInput,
  UpdateSinkingFundInput,
} from "@/lib/finance/catwallet";

type SinkingFundAction = (data: SinkingFundInput) => Promise<void>;

type SinkingFundsScreenProps = {
  createAction: SinkingFundAction;
  deleteAction: (id: string) => Promise<void>;
  funds: SinkingFund[];
  updateAction: (data: UpdateSinkingFundInput) => Promise<void>;
};

type FundForm = Omit<SinkingFundInput, "expectedUseDate"> & {
  expectedUseDate: string;
};

function emptyForm(): FundForm {
  return {
    currentAmount: 0,
    emoji: "🛟",
    expectedUseDate: "",
    isEnabled: true,
    monthlyTarget: 0,
    name: "",
    notes: "",
    targetAmount: null,
  };
}

function toForm(fund: SinkingFund): FundForm {
  return {
    currentAmount: fund.currentAmount,
    emoji: fund.emoji,
    expectedUseDate: fund.expectedUseDate ?? "",
    isEnabled: fund.isEnabled,
    monthlyTarget: fund.monthlyTarget,
    name: fund.name,
    notes: fund.notes ?? "",
    targetAmount: fund.targetAmount,
  };
}

export function SinkingFundsScreen({
  createAction,
  deleteAction,
  funds,
  updateAction,
}: SinkingFundsScreenProps) {
  const { formatCurrency, t } = useI18n();
  const router = useRouter();
  const [form, setForm] = useState<FundForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateField<K extends keyof FundForm>(key: K, value: FundForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submitForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const input: SinkingFundInput = {
      ...form,
      expectedUseDate: form.expectedUseDate || null,
      notes: form.notes || null,
    };
    startTransition(async () => {
      try {
        if (editingId) {
          const updateInput = { ...input };
          delete updateInput.currentAmount;
          await updateAction({ ...updateInput, id: editingId });
        } else {
          await createAction(input);
        }
        setForm(emptyForm());
        setEditingId(null);
        router.refresh();
      } catch {
        setError(t("common.saveError"));
      }
    });
  }

  function removeFund(id: string) {
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

  return (
    <main className="space-y-6">
      <PageHeader
        title={t("catwallet.sinkingFunds")}
        description={t("catwallet.sinkingFundsDescription")}
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PiggyBank className="size-5 text-primary" aria-hidden="true" />
            {editingId ? t("common.edit") : t("catwallet.sinkingFunds")}
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
            <Field label={t("catwallet.emoji")}>
              <Input
                required
                maxLength={16}
                value={form.emoji}
                onChange={(event) => updateField("emoji", event.target.value)}
              />
            </Field>
            <Field label={t("catwallet.currentAmount")}>
              <Input
                disabled={Boolean(editingId)}
                min="0"
                step="0.01"
                type="number"
                value={form.currentAmount || ""}
                onChange={(event) =>
                  updateField("currentAmount", Number(event.target.value))
                }
              />
            </Field>
            <Field label={t("catwallet.monthlyTarget")}>
              <Input
                min="0"
                step="0.01"
                type="number"
                value={form.monthlyTarget || ""}
                onChange={(event) =>
                  updateField("monthlyTarget", Number(event.target.value))
                }
              />
            </Field>
            <Field label={t("catwallet.targetAmount")}>
              <Input
                min="0.01"
                step="0.01"
                type="number"
                value={form.targetAmount ?? ""}
                onChange={(event) =>
                  updateField(
                    "targetAmount",
                    event.target.value ? Number(event.target.value) : null,
                  )
                }
              />
            </Field>
            <Field label={t("catwallet.targetDate")}>
              <Input
                type="date"
                value={form.expectedUseDate}
                onChange={(event) =>
                  updateField("expectedUseDate", event.target.value)
                }
              />
            </Field>
            <div className="md:col-span-2">
              <Field label={t("transaction.notes")}>
                <Textarea
                  value={form.notes ?? ""}
                  onChange={(event) => updateField("notes", event.target.value)}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground md:col-span-2">
              <input
                checked={form.isEnabled}
                type="checkbox"
                onChange={(event) =>
                  updateField("isEnabled", event.target.checked)
                }
              />
              {t("catwallet.enabled")}
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {funds.map((fund) => (
          <SinkingFundCard
            key={fund.id}
            formatCurrency={formatCurrency}
            fund={fund}
            onDelete={() => removeFund(fund.id)}
            onEdit={() => {
              setEditingId(fund.id);
              setForm(toForm(fund));
            }}
            t={t}
          />
        ))}
      </div>
      {funds.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("common.noDataForPeriod")}
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}

function SinkingFundCard({
  formatCurrency,
  fund,
  onDelete,
  onEdit,
  t,
}: {
  formatCurrency: (amount: number) => string;
  fund: SinkingFund;
  onDelete: () => void;
  onEdit: () => void;
  t: (key: string) => string;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <CardTitle>
          {fund.emoji} {fund.name}
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          {fund.isEnabled ? t("catwallet.enabled") : t("catwallet.disabled")}
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-between text-sm">
          <span>{t("catwallet.currentAmount")}</span>
          <strong>{formatCurrency(fund.currentAmount)}</strong>
        </div>
        <div className="flex justify-between text-sm">
          <span>{t("catwallet.monthlyTarget")}</span>
          <strong>{formatCurrency(fund.monthlyTarget)}</strong>
        </div>
        {fund.targetAmount ? (
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{t("catwallet.targetAmount")}</span>
            <span>{formatCurrency(fund.targetAmount)}</span>
          </div>
        ) : null}
        {fund.expectedUseDate ? (
          <p className="text-xs text-muted-foreground">
            {t("catwallet.targetDate")}: {fund.expectedUseDate}
          </p>
        ) : null}
        <SinkingFundCardActions onDelete={onDelete} onEdit={onEdit} t={t} />
      </CardContent>
    </Card>
  );
}

function SinkingFundCardActions({
  onDelete,
  onEdit,
  t,
}: {
  onDelete: () => void;
  onEdit: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" onClick={onEdit}>
        <Pencil className="size-4" aria-hidden="true" />
        {t("common.edit")}
      </Button>
      <Button size="sm" variant="destructive" onClick={onDelete}>
        <Trash2 className="size-4" aria-hidden="true" />
        {t("common.delete")}
      </Button>
    </div>
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
