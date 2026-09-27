"use client";

import Link from "next/link";
import { ListPlus, ShoppingBag, Sparkles } from "lucide-react";

import { useI18n } from "@/lib/i18n";

const shortcuts = [
  {
    href: "/transactions/new",
    icon: ListPlus,
    label: "transactions.center.add",
  },
  { href: "/fun-money", icon: Sparkles, label: "transactions.center.funMoney" },
  { href: "/cooling", icon: ShoppingBag, label: "transactions.center.cooling" },
] as const;

export function TransactionCenterShortcuts() {
  const { t } = useI18n();

  return (
    <nav
      aria-label={t("transactions.center.title")}
      className="mb-4 flex flex-wrap gap-2"
    >
      {shortcuts.map(({ href, icon: Icon, label }) => (
        <Link
          key={href}
          href={href}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Icon className="size-4" aria-hidden="true" />
          {t(label)}
        </Link>
      ))}
    </nav>
  );
}
