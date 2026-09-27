"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  CalendarClock,
  ChevronDown,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

import type { CatWalletDashboardData } from "@/lib/finance/catwallet";
import { saveMonthlyAvailableIncomeAction } from "@/app/dashboard/actions";
import { useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type CatWalletSummaryProps = {
  data: CatWalletDashboardData;
};

export function CatWalletSummary({ data }: CatWalletSummaryProps) {
  const router = useRouter();
  const [availableIncomeError, setAvailableIncomeError] = useState(false);
  const [savingAvailableIncome, setSavingAvailableIncome] = useState(false);
  const { formatCurrency, formatDate, t } = useI18n();
  const safeToSpend = data.safeToSpend.safeToSpend;
  const dataQuality = data.safeToSpend.dataQuality ?? "partial";
  const isConfigured =
    data.monthlyAmountConfigured ?? data.safeToSpend.income > 0;
  const isVerified = isConfigured && dataQuality === "verified";
  const assetAccounts = (data.accountBalances ?? []).filter(
    (account) => account.type !== "credit",
  );
  const untrackedAccounts = assetAccounts.filter(
    (account) => !account.balanceTrackingEnabled,
  );
  const missingBalances = assetAccounts.filter(
    (account) =>
      account.balanceTrackingEnabled && account.currentBalance == null,
  );
  let statusLabel = t("catwallet.reconciliationPending");
  if (!isConfigured) {
    statusLabel = t("catwallet.notConfigured");
  } else if (isVerified) {
    statusLabel = t("catwallet.reconciled");
  }
  const safeValue = isConfigured ? formatCurrency(safeToSpend) : statusLabel;

  async function saveAvailableIncome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAvailableIncomeError(false);
    setSavingAvailableIncome(true);
    const amount = Number(new FormData(event.currentTarget).get("amount"));
    try {
      await saveMonthlyAvailableIncomeAction(data.month, amount);
      router.refresh();
    } catch {
      setAvailableIncomeError(true);
    } finally {
      setSavingAvailableIncome(false);
    }
  }

  return (
    <section
      aria-label={t("catwallet.monthlySafeToSpend")}
      className="space-y-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            CatWallet
          </p>
          <h1 className="mt-1 text-2xl font-bold text-foreground">
            {t("catwallet.monthlySafeToSpend")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{data.month}</p>
        </div>
        <Badge variant={isVerified ? "secondary" : "outline"}>
          {statusLabel}
        </Badge>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <SummaryMetric
          className="border-primary/30 bg-primary/5 lg:col-span-2"
          icon={ShieldCheck}
          label={t("catwallet.monthlySafeToSpend")}
          value={safeValue}
          valueClassName={safeToSpend < 0 ? "text-destructive" : undefined}
        />
        {isConfigured && !isVerified ? (
          <div className="space-y-1 text-sm text-muted-foreground lg:col-span-2">
            {assetAccounts.length === 0 ? (
              <p>{t("catwallet.noAssetAccounts")}</p>
            ) : null}
            {untrackedAccounts.length > 0 ? (
              <p>
                {t("catwallet.balanceTrackingOff")}:{" "}
                {untrackedAccounts.map((account) => account.name).join("、")}
              </p>
            ) : null}
            {missingBalances.length > 0 ? (
              <p>
                {t("catwallet.balanceNotSet")}:{" "}
                {missingBalances.map((account) => account.name).join("、")}
              </p>
            ) : null}
            {assetAccounts.length > 0 &&
            untrackedAccounts.length === 0 &&
            missingBalances.length === 0 ? (
              <p>{t("catwallet.reviewFinancialData")}</p>
            ) : null}
            <Link
              className="inline-block font-medium text-primary underline-offset-4 hover:underline"
              href={`/payments?month=${data.month}`}
            >
              {t("catwallet.openAccounts")}
            </Link>
          </div>
        ) : null}
        {!isConfigured ? (
          <div className="space-y-2 text-sm text-muted-foreground lg:col-span-2">
            <p>{t("catwallet.balanceIsNotIncome")}</p>
            <form
              onSubmit={saveAvailableIncome}
              className="flex flex-wrap items-end gap-2"
            >
              <label className="space-y-1 font-medium text-foreground">
                <span>{t("catwallet.setMonthlyAvailableIncome")}</span>
                <input
                  name="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  className="block w-40 rounded-lg border border-border bg-card px-3 py-2"
                />
              </label>
              <button
                type="submit"
                disabled={savingAvailableIncome}
                className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-60"
              >
                {savingAvailableIncome
                  ? t("catwallet.savingMonthlyAvailableIncome")
                  : t("catwallet.saveMonthlyAvailableIncome")}
              </button>
            </form>
            {availableIncomeError ? (
              <p role="alert" className="text-destructive">
                {t("catwallet.monthlyAvailableIncomeError")}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryMetric
          label={t("catwallet.cashAndDeposits")}
          value={formatCurrency(data.totalAssets ?? 0)}
          href={`/payments?month=${data.month}`}
        />
        <SummaryMetric
          label={t("catwallet.cardLiabilities")}
          value={formatCurrency(data.totalLiabilities ?? 0)}
          valueClassName="text-destructive"
          href={`/payments?month=${data.month}`}
        />
        <SummaryMetric
          label={t("catwallet.netFunds")}
          value={formatCurrency(data.netFunds ?? 0)}
        />
      </div>
      {data.totalAssets === 0 &&
      !data.accountBalances?.some(
        (account) => account.currentBalance != null,
      ) ? (
        <p className="text-sm text-muted-foreground">
          {t("catwallet.noAssetBalances")}{" "}
          <Link
            className="font-medium text-primary underline-offset-4 hover:underline"
            href={`/payments?month=${data.month}`}
          >
            {t("catwallet.openAccounts")}
          </Link>
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryMetric
          label={t("catwallet.incomeUsed")}
          value={formatCurrency(data.safeToSpend.income)}
        />
        <SummaryMetric
          icon={WalletCards}
          label={t("catwallet.spent")}
          value={formatCurrency(data.safeToSpend.spent)}
          href={`/transactions?month=${data.month}`}
        />
        <SummaryMetric
          label={t("catwallet.monthlyReserve")}
          value={formatCurrency(data.safeToSpend.monthlyReserve ?? 0)}
        />
        <SummaryMetric
          label={t("catwallet.dataUpdated")}
          value={
            data.refreshedAt
              ? formatDate(data.refreshedAt, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })
              : "—"
          }
          detail={t("catwallet.monthlySummaryScope")}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SummaryMetric
          icon={CalendarClock}
          label={t("catwallet.nextDue")}
          value={
            data.nextDue
              ? formatCurrency(data.nextDue.amount)
              : t("catwallet.noUpcomingDue")
          }
          detail={
            data.nextDue
              ? `${t(data.nextDue.descriptionKey)} · ${formatDate(data.nextDue.date)} · ${t("catwallet.billReminderOnly")}`
              : t("catwallet.noDueExplanation")
          }
          href={`/payments?month=${data.month}`}
        />
        <Link
          href={`/transactions/new?month=${data.month}`}
          className="flex items-center justify-center rounded-xl border border-primary/30 bg-primary/5 p-4 font-semibold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t("nav.addTransaction")}
        </Link>
      </div>

      <details className="rounded-xl border border-border bg-card/70 p-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-foreground">
          <span>{t("catwallet.calculationDetails")}</span>
          <ChevronDown
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
        </summary>
        <div className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <DetailRow
            label={t("catwallet.incomeUsed")}
            value={formatCurrency(data.safeToSpend.income)}
          />
          <DetailRow
            label={t("catwallet.fixedCommitments")}
            value={formatCurrency(data.safeToSpend.fixedCommitments)}
          />
          <DetailRow
            label={t("catwallet.dueCommitments")}
            value={formatCurrency(data.safeToSpend.unpaidDueCommitments ?? 0)}
          />
          <DetailRow
            label={t("catwallet.monthlyReserve")}
            value={formatCurrency(data.safeToSpend.monthlyReserve ?? 0)}
          />
          <DetailRow
            label={t("catwallet.dailySpending")}
            value={formatCurrency(
              data.safeToSpend.unprepaidDailySpent ??
                data.safeToSpend.regularSpent,
            )}
          />
        </div>
        <Link
          className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
          href="/reports"
        >
          {t("catwallet.openReports")}
        </Link>
      </details>
    </section>
  );
}

function SummaryMetric({
  className,
  detail,
  href,
  icon: Icon,
  label,
  value,
  valueClassName,
}: {
  className?: string;
  detail?: string;
  href?: string;
  icon?: typeof WalletCards;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  const content = (
    <div
      className={cn("rounded-xl border border-border bg-card p-4", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {Icon ? (
          <Icon className="size-4 text-primary" aria-hidden="true" />
        ) : null}
      </div>
      <p
        className={cn(
          "mt-3 text-xl font-semibold text-foreground",
          valueClassName,
        )}
      >
        {value}
      </p>
      {detail ? (
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  );

  return href ? (
    <Link
      className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      href={href}
    >
      {content}
    </Link>
  ) : (
    content
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2">
      <span>{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}
