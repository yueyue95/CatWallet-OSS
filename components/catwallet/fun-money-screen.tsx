"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Heart, Sparkles } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import type { FunMoneyOverview } from "@/lib/finance/catwallet";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Props = {
  overview: FunMoneyOverview;
  saveBudgetAction: (data: { amount: number; month: string }) => Promise<void>;
};

export function FunMoneyScreen({ overview, saveBudgetAction }: Props) {
  const { formatCurrency, t } = useI18n();
  const [amount, setAmount] = useState(overview.budget.toFixed(2));
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function saveBudget(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const nextAmount = Number(amount);
    if (!Number.isFinite(nextAmount) || nextAmount < 0) {
      setMessage(t("funMoney.invalidAmount"));
      return;
    }
    startTransition(async () => {
      try {
        await saveBudgetAction({ amount: nextAmount, month: overview.month });
        setMessage(t("funMoney.saved"));
      } catch {
        setMessage(t("funMoney.saveError"));
      }
    });
  }

  const progress = overview.budgetSet
    ? Math.min(Math.max(overview.percentage, 0), 100)
    : 0;

  return (
    <main className="space-y-6">
      <PageHeader
        title={t("funMoney.title")}
        description={t("funMoney.description")}
      />

      <Card className="border-wants/30 bg-wants/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-wants" aria-hidden="true" />
            {t("funMoney.monthlyAllowance")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {overview.budgetSet ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("funMoney.budget")}
                </p>
                <p className="text-2xl font-semibold">
                  {formatCurrency(overview.budget)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("funMoney.spent")}
                </p>
                <p className="text-2xl font-semibold">
                  {formatCurrency(overview.spent)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {overview.isOverBudget
                    ? t("funMoney.overBy")
                    : t("funMoney.remaining")}
                </p>
                <p
                  className={cn(
                    "text-2xl font-semibold",
                    overview.isOverBudget && "text-destructive",
                  )}
                >
                  {formatCurrency(
                    overview.isOverBudget
                      ? overview.overAmount
                      : overview.remaining,
                  )}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("funMoney.notConfigured")}
            </p>
          )}
          <Progress value={progress} aria-label={t("funMoney.progress")} />
          <p className="text-sm text-muted-foreground">
            {overview.budgetSet
              ? t("funMoney.progressText").replace(
                  "{percentage}",
                  String(overview.percentage),
                )
              : t("funMoney.setHint")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("funMoney.setTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="max-w-md space-y-4" onSubmit={saveBudget}>
            <label className="block space-y-2 text-sm">
              {t("funMoney.amountLabel")}
              <Input
                inputMode="decimal"
                min="0"
                onChange={(event) => setAmount(event.target.value)}
                step="0.01"
                type="number"
                value={amount}
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={isPending} type="submit">
                {isPending ? t("transaction.saving") : t("funMoney.save")}
              </Button>
              <Button asChild variant="outline">
                <Link href="/transactions/new?funMoney=1">
                  <Heart className="size-4" aria-hidden="true" />
                  {t("funMoney.recordExpense")}
                </Link>
              </Button>
            </div>
            {message ? <p role="status">{message}</p> : null}
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
