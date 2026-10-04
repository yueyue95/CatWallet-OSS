"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/dashboard/page-header";
import { useI18n } from "@/lib/i18n";
import type {
  InstallmentOverviewItem,
  InstallmentRetirementAllocation,
  SaveInstallmentRetirementInput,
  SinkingFund,
} from "@/lib/finance/catwallet";
import type { TransactionFormCategory } from "@/lib/finance/transactions";
import type { InstallmentDeletePreview } from "@/lib/finance/transactions";

type Props = {
  categories: TransactionFormCategory[];
  deleteInstallmentAction: (data: { planId: string }) => Promise<void>;
  items: InstallmentOverviewItem[];
  previewDeleteInstallmentAction: (data: {
    planId: string;
  }) => Promise<InstallmentDeletePreview>;
  restoreInstallmentAction: (data: { planId: string }) => Promise<void>;
  saveAllocationAction: (
    data: SaveInstallmentRetirementInput,
  ) => Promise<InstallmentRetirementAllocation[]>;
  sinkingFunds: SinkingFund[];
  view?: "active" | "deleted";
};
type Draft = {
  key: number;
  monthlyAmount: string;
  targetType: "savings" | "category" | "sinking_fund";
  targetId: string;
};
const blank = (key: number): Draft => ({
  key,
  monthlyAmount: "",
  targetType: "savings",
  targetId: "",
});

function Editor({
  item,
  categories,
  sinkingFunds,
  saveAllocationAction,
  onCancel,
  onSaved,
}: Props & {
  item: InstallmentOverviewItem;
  onCancel: () => void;
  onSaved: (allocations: InstallmentRetirementAllocation[]) => void;
}) {
  const { t, formatCurrency, formatDate } = useI18n();
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    item.allocations.length
      ? item.allocations.map((a, key) => ({
          key,
          monthlyAmount: String(a.monthlyAmount),
          targetType: a.targetType,
          targetId: a.targetId ?? "",
        }))
      : [blank(0)],
  );
  const [startsMonth, setStartsMonth] = useState(
    item.allocations[0]?.startsMonth ?? item.retirementStartsMonth,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const nextKey = useRef(drafts.length);
  const cents = drafts.reduce(
    (sum, row) => sum + Math.round(Number(row.monthlyAmount || 0) * 100),
    0,
  );
  const release = Math.round(item.monthlyAmount * 100);
  function update(key: number, patch: Partial<Draft>) {
    setDrafts((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }
  function remove(key: number) {
    setDrafts((current) => current.filter((draft) => draft.key !== key));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    if (cents > release) {
      setError(
        t("retirement.exceeds").replace(
          "{amount}",
          formatCurrency(item.monthlyAmount),
        ),
      );
      return;
    }
    const identities = drafts.map((row) => row.targetType + ":" + row.targetId);
    if (new Set(identities).size !== identities.length) {
      setError(t("retirement.duplicate"));
      return;
    }
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await saveAllocationAction({
        installmentGroupId: item.groupId,
        startsMonth,
        allocations: drafts.map((row) => ({
          monthlyAmount: Number(row.monthlyAmount),
          targetType: row.targetType,
          targetId: row.targetType === "savings" ? null : row.targetId,
        })),
      });
      onSaved(result);
    } catch {
      setError(t("common.allocationError"));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      onChange={() => setError(null)}
      className="space-y-4 rounded-xl border bg-background p-4"
    >
      <label className="block space-y-2 text-sm">
        {t("retirement.startsMonth")}
        <Input
          required
          type="month"
          min={item.retirementStartsMonth}
          value={startsMonth}
          disabled={pending}
          onChange={(event) => setStartsMonth(event.target.value)}
        />
        <output className="block text-xs text-muted-foreground">
          {formatDate(`${startsMonth}-01`, {
            month: "long",
            year: "numeric",
          })}
        </output>
      </label>
      {drafts.map((row, index) => (
        <fieldset
          key={row.key}
          disabled={pending}
          className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2"
        >
          <label className="space-y-2 text-sm">
            {t("retirement.amount")} {index + 1}
            <Input
              required
              type="number"
              min="0.01"
              step="0.01"
              value={row.monthlyAmount}
              onChange={(event) =>
                update(row.key, { monthlyAmount: event.target.value })
              }
            />
          </label>
          <label className="space-y-2 text-sm">
            {t("retirement.type")} {index + 1}
            <select
              className="h-10 w-full rounded-md border bg-background px-2"
              value={row.targetType}
              onChange={(event) =>
                update(row.key, {
                  targetType: event.target.value as Draft["targetType"],
                  targetId: "",
                })
              }
            >
              <option value="savings">{t("catwallet.longTermSavings")}</option>
              <option value="sinking_fund">
                {t("catwallet.sinkingFunds")}
              </option>
              <option value="category">{t("common.category")}</option>
            </select>
          </label>
          {row.targetType !== "savings" ? (
            <label className="space-y-2 text-sm">
              {t("retirement.target")} {index + 1}
              <select
                required
                className="h-10 w-full rounded-md border bg-background px-2"
                value={row.targetId}
                onChange={(event) =>
                  update(row.key, { targetId: event.target.value })
                }
              >
                <option value="">{t("retirement.selectTarget")}</option>
                {row.targetType === "category"
                  ? categories
                      .filter((c) => c.id !== "none" && c.group !== "income")
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {t(c.label)}
                        </option>
                      ))
                  : sinkingFunds.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.emoji} {f.name}
                      </option>
                    ))}
              </select>
            </label>
          ) : null}
          <Button type="button" variant="ghost" onClick={() => remove(row.key)}>
            {t("retirement.remove")}
          </Button>
        </fieldset>
      ))}
      <Button
        type="button"
        disabled={pending}
        variant="outline"
        onClick={() =>
          setDrafts((current) => [...current, blank(nextKey.current++)])
        }
      >
        {t("retirement.add")}
      </Button>
      <p className="text-sm">
        {t("retirement.total")}: {formatCurrency(cents / 100)}
      </p>
      {cents < release ? (
        <p className="text-sm text-muted-foreground">
          {t("retirement.unallocated").replace(
            "{amount}",
            formatCurrency((release - cents) / 100),
          )}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {t(pending ? "transaction.saving" : "retirement.save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onCancel}
        >
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

type InstallmentOperation = "delete" | "restore" | null;

async function applyInstallmentLifecycle(
  props: Props,
  planId: string,
  operation: InstallmentOperation,
) {
  if (operation === "delete") {
    return props.deleteInstallmentAction({ planId });
  }
  if (operation === "restore") {
    return props.restoreInstallmentAction({ planId });
  }
}

function useInstallmentLifecycle(props: Props, item: InstallmentOverviewItem) {
  const { t } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [operation, setOperation] = useState<InstallmentOperation>(null);
  const [preview, setPreview] = useState<InstallmentDeletePreview | null>(null);
  async function requestDelete() {
    setPending(true);
    setError(null);
    try {
      const result = await props.previewDeleteInstallmentAction({
        planId: item.groupId,
      });
      if (!result.canDelete) return setError(result.blockers.join(", "));
      setPreview(result);
      setOperation("delete");
    } catch {
      setError(t("installments.lifecycleError"));
    } finally {
      setPending(false);
    }
  }
  function requestRestore() {
    setOperation("restore");
  }
  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await applyInstallmentLifecycle(props, item.groupId, operation);
      setOperation(null);
      router.refresh();
    } catch {
      setError(t("installments.lifecycleError"));
    } finally {
      setPending(false);
    }
  }
  return {
    close: () => setOperation(null),
    confirm,
    error,
    operation,
    pending,
    preview,
    requestDelete,
    requestRestore,
  };
}

type InstallmentLifecycle = ReturnType<typeof useInstallmentLifecycle>;

function InstallmentManageMenu({
  item,
  lifecycle,
  t,
}: {
  item: InstallmentOverviewItem;
  lifecycle: InstallmentLifecycle;
  t: (key: string) => string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" disabled={lifecycle.pending}>
          {t("installments.manage")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {item.archivedAt ? (
          <DropdownMenuItem onClick={lifecycle.requestRestore}>
            {t("installments.restore")}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={!item.retired}
            onClick={lifecycle.requestDelete}
          >
            {t("installments.delete")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InstallmentLifecycleSummary({
  item,
  occurrenceCount,
}: {
  item: InstallmentOverviewItem;
  occurrenceCount: number;
}) {
  const { formatCurrency, t } = useI18n();
  const rows = [
    [
      t("retirement.progress"),
      `${item.currentInstallment}/${item.totalInstallments}`,
    ],
    [
      t("common.remaining"),
      `${item.remainingInstallments} · ${formatCurrency(item.remainingAmount)}`,
    ],
    [t("installments.affectedPlan"), "1"],
    [t("installments.affectedOccurrences"), String(occurrenceCount)],
    [
      t("installments.affectedTransactions"),
      t("installments.linkedTransactionsFollow"),
    ],
  ];
  return (
    <dl className="grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function InstallmentLifecycleDialog({
  item,
  lifecycle,
}: {
  item: InstallmentOverviewItem;
  lifecycle: InstallmentLifecycle;
}) {
  const { t } = useI18n();
  const restoring = lifecycle.operation === "restore";
  const occurrenceCount =
    lifecycle.preview?.occurrenceCount ?? item.totalInstallments;
  return (
    <Dialog
      open={lifecycle.operation !== null}
      onOpenChange={(open) => !open && lifecycle.close()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(
              restoring
                ? "installments.restoreTitle"
                : "installments.deleteTitle",
            )}
          </DialogTitle>
          <DialogDescription>{item.name}</DialogDescription>
        </DialogHeader>
        <InstallmentLifecycleSummary
          item={item}
          occurrenceCount={occurrenceCount}
        />
        <section className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
          <h3 className="font-medium">{t("installments.financialImpact")}</h3>
          <p className="mt-1 text-muted-foreground">
            {t(
              restoring
                ? "installments.restoreImpact"
                : "installments.deleteImpact",
            )}
          </p>
        </section>
        <InstallmentLifecycleDialogFooter
          lifecycle={lifecycle}
          restoring={restoring}
        />
      </DialogContent>
    </Dialog>
  );
}

function InstallmentLifecycleDialogFooter({
  lifecycle,
  restoring,
}: {
  lifecycle: InstallmentLifecycle;
  restoring: boolean;
}) {
  const { t } = useI18n();
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={lifecycle.close}>
        {t("common.cancel")}
      </Button>
      <Button
        type="button"
        variant={restoring ? "default" : "destructive"}
        disabled={lifecycle.pending}
        onClick={lifecycle.confirm}
      >
        {t(
          restoring
            ? "installments.confirmRestore"
            : "installments.confirmDelete",
        )}
      </Button>
    </DialogFooter>
  );
}

function InstallmentLifecycleControls(
  props: Props & { item: InstallmentOverviewItem },
) {
  const { item } = props;
  const { t } = useI18n();
  const lifecycle = useInstallmentLifecycle(props, item);
  return (
    <>
      <InstallmentManageMenu item={item} lifecycle={lifecycle} t={t} />
      <InstallmentLifecycleDialog item={item} lifecycle={lifecycle} />
      {lifecycle.error ? (
        <p className="text-sm text-destructive">{lifecycle.error}</p>
      ) : null}
    </>
  );
}

function InstallmentStatusBadge({ item }: { item: InstallmentOverviewItem }) {
  const { t } = useI18n();
  if (!item.archivedAt && !item.retired) return null;
  return (
    <Badge variant={item.archivedAt ? "secondary" : "outline"}>
      {t(
        item.archivedAt
          ? "installments.deletedStatus"
          : "installments.retiredStatus",
      )}
    </Badge>
  );
}

function InstallmentCard(props: Props & { item: InstallmentOverviewItem }) {
  const { item, categories, sinkingFunds } = props;
  const { t, formatCurrency, formatDate } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<InstallmentRetirementAllocation[] | null>(
    null,
  );
  const allocations = saved ?? item.allocations;
  const allocatedCents = allocations.reduce(
    (sum, allocation) => sum + Math.round(allocation.monthlyAmount * 100),
    0,
  );
  const releasedCents = Math.round(item.monthlyAmount * 100);
  function targetLabel(a: InstallmentRetirementAllocation) {
    if (a.targetType === "savings") return t("catwallet.longTermSavings");
    if (a.targetType === "category")
      return t(
        categories.find((c) => c.id === a.targetId)?.label ?? "common.category",
      );
    const fund = sinkingFunds.find((f) => f.id === a.targetId);
    return fund ? fund.emoji + " " + fund.name : t("catwallet.sinkingFunds");
  }
  function onSaved(result: InstallmentRetirementAllocation[]) {
    setSaved(result);
    setOpen(false);
    try {
      router.refresh();
    } catch {
      /* The persisted summary remains visible. */
    }
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{item.name}</CardTitle>
          <InstallmentStatusBadge item={item} />
        </div>
        <p className="text-sm text-muted-foreground">
          {t("retirement.progress")}: {item.currentInstallment}/
          {item.totalInstallments}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt>{t("retirement.totalPurchase")}</dt>
            <dd className="font-semibold">
              {formatCurrency(item.totalAmount)}
            </dd>
          </div>
          <div>
            <dt>
              {t(
                item.amountMode === "per_installment"
                  ? "retirement.perPeriod"
                  : "retirement.perPeriodTotal",
              )}
            </dt>
            <dd className="font-semibold">
              {formatCurrency(item.monthlyAmount)}
            </dd>
          </div>
          <div>
            <dt>{t("common.remaining")}</dt>
            <dd className="font-semibold">
              {formatCurrency(item.remainingAmount)}
            </dd>
          </div>
          <div>
            <dt>{t("retirement.endMonth")}</dt>
            <dd className="font-semibold">
              {formatDate(`${item.endDate.slice(0, 7)}-01`, {
                month: "long",
                year: "numeric",
              })}
            </dd>
          </div>
          <div>
            <dt>{t("retirement.remainingInstallments")}</dt>
            <dd className="font-semibold">{item.remainingInstallments}</dd>
          </div>
        </dl>
        {allocations.length ? (
          <section className="space-y-1 rounded-lg bg-primary/5 p-3 text-sm">
            <h3 className="font-medium">{t("retirement.summary")}</h3>
            <p className="font-medium">
              {t("retirement.monthlyReleaseAfter").replace(
                "{amount}",
                formatCurrency(item.monthlyAmount),
              )}
            </p>
            {allocations.map((a) => (
              <p key={a.id}>
                {formatCurrency(a.monthlyAmount)} → {targetLabel(a)}
              </p>
            ))}
            <p className="text-xs text-muted-foreground">
              {t("retirement.startsMonth")}:{" "}
              {formatDate(`${allocations[0].startsMonth}-01`, {
                month: "long",
                year: "numeric",
              })}
            </p>
            {allocatedCents > releasedCents ? (
              <p className="text-destructive">
                {t("retirement.exceeds").replace(
                  "{amount}",
                  formatCurrency(item.monthlyAmount),
                )}
              </p>
            ) : null}
            {allocatedCents < releasedCents ? (
              <p className="text-muted-foreground">
                {t("retirement.unallocated").replace(
                  "{amount}",
                  formatCurrency((releasedCents - allocatedCents) / 100),
                )}
              </p>
            ) : null}
          </section>
        ) : null}
        {!item.archivedAt ? (
          <Button
            variant="outline"
            aria-expanded={open}
            disabled={open}
            onClick={() => setOpen(true)}
          >
            {t(allocations.length ? "retirement.edit" : "retirement.setup")}
          </Button>
        ) : null}
        <InstallmentLifecycleControls {...props} item={item} />
        {open && !item.archivedAt ? (
          <Editor
            {...props}
            item={{ ...item, allocations }}
            onCancel={() => setOpen(false)}
            onSaved={onSaved}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

export function InstallmentsScreen(props: Props) {
  const { t } = useI18n();
  return (
    <main className="space-y-6">
      <PageHeader
        title={t("catwallet.installments")}
        description={t("catwallet.installmentsDescription")}
      />
      <Button asChild type="button" variant="outline">
        <Link
          href={
            props.view === "deleted"
              ? "/installments"
              : "/installments?view=deleted"
          }
        >
          {t(
            props.view === "deleted"
              ? "installments.showActive"
              : "installments.showDeleted",
          )}
        </Link>
      </Button>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {props.items.map((item) => (
          <InstallmentCard key={item.groupId} {...props} item={item} />
        ))}
      </div>
      {!props.items.length ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("transactions.installments.empty")}
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
