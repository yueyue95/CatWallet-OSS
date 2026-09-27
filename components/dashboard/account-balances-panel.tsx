"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import type { AccountBalance } from "@/lib/finance/account-balances";
import { useI18n } from "@/lib/i18n";

type AccountBalancesPanelProps = {
  accounts: AccountBalance[];
  addAdjustmentAction: (data: {
    amount: string;
    effectiveDate: string;
    note?: string;
    paymentMethodId: string;
  }) => Promise<void>;
  setOpeningBalanceAction: (data: {
    amount: string;
    effectiveDate: string;
    paymentMethodId: string;
  }) => Promise<void>;
};

type BalanceDialogState = {
  account: AccountBalance;
  amount: string;
  date: string;
  mode: "adjustment" | "opening";
  note: string;
} | null;

export function AccountBalancesPanel({
  accounts,
  addAdjustmentAction,
  setOpeningBalanceAction,
}: AccountBalancesPanelProps) {
  const { formatCurrency, t } = useI18n();
  const [dialog, setDialog] = useState<BalanceDialogState>(null);
  const [isPending, startTransition] = useTransition();

  const openDialog = (
    account: AccountBalance,
    mode: "opening" | "adjustment",
  ) => {
    setDialog({
      account,
      amount: mode === "opening" ? String(account.openingBalance ?? "") : "",
      date: account.openingDate ?? new Date().toISOString().slice(0, 10),
      mode,
      note: "",
    });
  };

  const save = () => {
    if (!dialog || !dialog.amount.trim() || !dialog.date) return;

    startTransition(() => {
      void (async () => {
        try {
          if (dialog.mode === "opening") {
            await setOpeningBalanceAction({
              amount: dialog.amount,
              effectiveDate: dialog.date,
              paymentMethodId: dialog.account.id,
            });
            toast.success(t("accountBalance.openingSaved"));
          } else {
            await addAdjustmentAction({
              amount: dialog.amount,
              effectiveDate: dialog.date,
              note: dialog.note.trim() || undefined,
              paymentMethodId: dialog.account.id,
            });
            toast.success(t("accountBalance.adjustmentSaved"));
          }
          setDialog(null);
        } catch (error) {
          console.error("Account balance update failed", error);
          toast.error(t("accountBalance.saveError"));
        }
      })();
    });
  };

  let dialogDescriptionKey = "accountBalance.openingDescription";
  let dialogAmountLabelKey = "accountBalance.openingAmount";
  if (dialog?.mode === "adjustment") {
    dialogDescriptionKey = "accountBalance.adjustmentDescription";
    dialogAmountLabelKey = "accountBalance.adjustmentAmount";
  } else if (dialog?.account.type === "credit") {
    dialogDescriptionKey = "accountBalance.liabilityOpeningDescription";
    dialogAmountLabelKey = "accountBalance.openingLiabilityAmount";
  }

  return (
    <Card className="mb-6 border-border bg-card card-shadow">
      <CardHeader>
        <CardTitle className="text-lg">{t("accountBalance.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("accountBalance.description")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("accountBalance.adjustmentCorrectionHint")}
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {accounts.map((account) => {
          const isCreditCard = account.type === "credit";
          const currentAmount = isCreditCard
            ? account.currentLiability
            : account.currentBalance;
          const currentLabelKey = isCreditCard
            ? "accountBalance.currentLiability"
            : "accountBalance.currentBalance";
          const openingLabelKey = isCreditCard
            ? "accountBalance.openingLiability"
            : "accountBalance.opening";

          return (
            <div
              key={account.id}
              className="rounded-xl border border-border/70 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {account.name}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t(`payments.type.${account.type}`)} ·{" "}
                    {account.balanceTrackingEnabled
                      ? t("accountBalance.trackingOn")
                      : t("accountBalance.trackingOff")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">
                    {t(currentLabelKey)}
                  </p>
                  <p className="text-lg font-semibold tabular-nums text-foreground">
                    {currentAmount == null
                      ? t("accountBalance.notSet")
                      : formatCurrency(currentAmount)}
                  </p>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t(openingLabelKey)}:{" "}
                {account.openingBalance == null
                  ? t("accountBalance.notSet")
                  : formatCurrency(account.openingBalance)}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openDialog(account, "opening")}
                >
                  {t("accountBalance.setOpening")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openDialog(account, "adjustment")}
                >
                  {t("accountBalance.addAdjustment")}
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>

      <Dialog
        open={Boolean(dialog)}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === "adjustment"
                ? t("accountBalance.addAdjustment")
                : t("accountBalance.setOpening")}
            </DialogTitle>
            <DialogDescription>{t(dialogDescriptionKey)}</DialogDescription>
          </DialogHeader>
          {dialog ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="account-balance-amount">
                  {t(dialogAmountLabelKey)}
                </Label>
                <Input
                  id="account-balance-amount"
                  inputMode="decimal"
                  onChange={(event) =>
                    setDialog({ ...dialog, amount: event.target.value })
                  }
                  placeholder="0.00"
                  step="0.01"
                  type="number"
                  value={dialog.amount}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="account-balance-date">
                  {t("accountBalance.date")}
                </Label>
                <Input
                  id="account-balance-date"
                  onChange={(event) =>
                    setDialog({ ...dialog, date: event.target.value })
                  }
                  type="date"
                  value={dialog.date}
                />
              </div>
              {dialog.mode === "adjustment" ? (
                <div className="space-y-2">
                  <Label htmlFor="account-balance-note">
                    {t("accountBalance.note")}
                  </Label>
                  <Input
                    id="account-balance-note"
                    onChange={(event) =>
                      setDialog({ ...dialog, note: event.target.value })
                    }
                    value={dialog.note}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              disabled={isPending}
              onClick={() => setDialog(null)}
              variant="outline"
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={isPending || !dialog?.amount.trim()}
              onClick={save}
            >
              {isPending ? t("accountBalance.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
