"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  ExternalLink,
  Hourglass,
  Plus,
  ShoppingCart,
  Trash2,
} from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
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
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import {
  getCoolingRemainingMs,
  getEffectiveCoolingStatus,
  type CoolingItem,
  type CoolingItemInput,
} from "@/lib/finance/cooling-model";

type CoolingAction = (data: CoolingItemInput) => Promise<void>;

type CoolingScreenProps = {
  abandonAction: (id: string) => Promise<void>;
  createAction: CoolingAction;
  items: CoolingItem[];
};

type CoolingForm = {
  amount: string;
  coolingDays: string;
  name: string;
  notes: string;
  url: string;
};

function emptyForm(): CoolingForm {
  return { amount: "", coolingDays: "7", name: "", notes: "", url: "" };
}

function formatRemaining(milliseconds: number) {
  const totalHours = Math.ceil(milliseconds / (60 * 60 * 1000));
  return {
    days: Math.floor(totalHours / 24),
    hours: totalHours % 24,
  };
}

export function CoolingScreen({
  abandonAction,
  createAction,
  items,
}: CoolingScreenProps) {
  const { formatCurrency, t } = useI18n();
  const [form, setForm] = useState<CoolingForm>(emptyForm);
  const [selectedItem, setSelectedItem] = useState<CoolingItem | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const visibleItems = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        status: getEffectiveCoolingStatus(item, now),
      })),
    [items, now],
  );

  function updateField<K extends keyof CoolingForm>(
    key: K,
    value: CoolingForm[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submitForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const amount = Number(form.amount);
    const coolingDays = Number(form.coolingDays);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t("cooling.invalidAmount"));
      return;
    }
    if (!Number.isInteger(coolingDays) || coolingDays < 0) {
      setError(t("cooling.invalidDays"));
      return;
    }

    startTransition(async () => {
      try {
        await createAction({
          amountCents: Math.round(amount * 100),
          coolingDays,
          name: form.name,
          notes: form.notes.trim() || null,
          url: form.url.trim() || null,
        });
        setForm(emptyForm());
      } catch {
        setError(t("cooling.saveError"));
      }
    });
  }

  function abandonItem(id: string) {
    setError(null);
    startTransition(async () => {
      try {
        await abandonAction(id);
      } catch {
        setError(t("cooling.actionError"));
      }
    });
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title={t("cooling.title")}
        description={t("cooling.description")}
      />

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Hourglass className="size-5 text-primary" aria-hidden="true" />
            {t("cooling.addTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={submitForm}>
            <Field id="cooling-name" label={t("cooling.name")}>
              <Input
                id="cooling-name"
                required
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
              />
            </Field>
            <Field id="cooling-amount" label={t("cooling.amount")}>
              <Input
                id="cooling-amount"
                required
                inputMode="decimal"
                min="0.01"
                step="0.01"
                type="number"
                value={form.amount}
                onChange={(event) => updateField("amount", event.target.value)}
              />
            </Field>
            <Field id="cooling-days" label={t("cooling.days")}>
              <Input
                id="cooling-days"
                min="0"
                step="1"
                type="number"
                value={form.coolingDays}
                onChange={(event) =>
                  updateField("coolingDays", event.target.value)
                }
              />
            </Field>
            <Field id="cooling-url" label={t("cooling.url")}>
              <Input
                id="cooling-url"
                inputMode="url"
                type="url"
                value={form.url}
                onChange={(event) => updateField("url", event.target.value)}
              />
            </Field>
            <div className="md:col-span-2">
              <Field id="cooling-notes" label={t("cooling.notes")}>
                <Textarea
                  id="cooling-notes"
                  value={form.notes}
                  onChange={(event) => updateField("notes", event.target.value)}
                />
              </Field>
            </div>
            {error ? (
              <p
                className="text-sm text-destructive md:col-span-2"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <div className="md:col-span-2">
              <Button disabled={isPending} type="submit">
                <Plus className="size-4" aria-hidden="true" />
                {t("cooling.add")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {visibleItems.map((item) => {
          const remaining = getCoolingRemainingMs(item, now);
          const countdown = formatRemaining(remaining);
          const purchaseHref = `/transactions/new?coolingItem=${encodeURIComponent(item.id)}`;

          return (
            <Card key={item.id}>
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle>{item.name}</CardTitle>
                  <p className="mt-2 text-xl font-semibold">
                    {formatCurrency(item.amountCents / 100)}
                  </p>
                </div>
                <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                  {t(`cooling.status.${item.status}`)}
                </span>
              </CardHeader>
              <CardContent className="space-y-4">
                {item.status === "cooling" ? (
                  <p className="text-sm text-muted-foreground">
                    {t("cooling.remaining")}: {countdown.days}
                    {t("cooling.daysShort")} {countdown.hours}
                    {t("cooling.hoursShort")}
                  </p>
                ) : null}
                {item.status === "ready" ? (
                  <p className="font-medium text-primary">
                    {t("cooling.released")}
                  </p>
                ) : null}
                {item.notes ? (
                  <p className="text-sm text-muted-foreground">{item.notes}</p>
                ) : null}
                {item.url ? (
                  <a
                    className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
                    href={item.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLink className="size-4" aria-hidden="true" />
                    {t("cooling.openLink")}
                  </a>
                ) : null}
                {item.status === "cooling" || item.status === "ready" ? (
                  <div className="flex flex-wrap gap-2">
                    {item.status === "cooling" ? (
                      <Button
                        disabled={isPending}
                        onClick={() => setSelectedItem(item)}
                        type="button"
                      >
                        <ShoppingCart className="size-4" aria-hidden="true" />
                        {t("cooling.buyAnyway")}
                      </Button>
                    ) : (
                      <Button asChild>
                        <Link href={purchaseHref}>
                          <ShoppingCart className="size-4" aria-hidden="true" />
                          {t("cooling.buyAnyway")}
                        </Link>
                      </Button>
                    )}
                    <Button
                      disabled={isPending}
                      onClick={() => abandonItem(item.id)}
                      type="button"
                      variant="outline"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      {t("cooling.abandon")}
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {visibleItems.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("cooling.empty")}
          </CardContent>
        </Card>
      ) : null}

      <Dialog
        open={selectedItem !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedItem(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cooling.buyDialogTitle")}</DialogTitle>
            <DialogDescription>
              {selectedItem
                ? t("cooling.buyDialogDescription").replace(
                    "{remaining}",
                    (() => {
                      const countdown = formatRemaining(
                        getCoolingRemainingMs(selectedItem, now),
                      );
                      return `${countdown.days}${t("cooling.daysShort")} ${countdown.hours}${t("cooling.hoursShort")}`;
                    })(),
                  )
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedItem(null)}>
              {t("cooling.continueCooling")}
            </Button>
            {selectedItem ? (
              <Button asChild>
                <Link
                  href={`/transactions/new?coolingItem=${encodeURIComponent(selectedItem.id)}`}
                >
                  {t("cooling.buyNow")}
                </Link>
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function Field({
  children,
  id,
  label,
}: {
  children: React.ReactNode;
  id: string;
  label: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
