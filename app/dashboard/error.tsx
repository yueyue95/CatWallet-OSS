"use client";

import { useI18n } from "@/lib/i18n";

export default function DashboardError({ retry }: { retry: () => void }) {
  const { t } = useI18n();
  return (
    <section
      role="alert"
      className="rounded-xl border border-destructive/30 bg-card p-6"
    >
      <h1 className="text-lg font-semibold text-foreground">
        {t("catwallet.loadError")}
      </h1>
      <button
        type="button"
        onClick={retry}
        className="mt-3 rounded-lg bg-primary px-4 py-2 text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {t("catwallet.retry")}
      </button>
    </section>
  );
}
