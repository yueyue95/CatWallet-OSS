/* v8 ignore file -- Auth header layout is covered through auth UI render tests. */
"use client";

import { WalletCards } from "lucide-react";

import { AuthLocaleSelect } from "@/components/auth/auth-locale-select";
import { useI18n } from "@/lib/i18n";

export function AuthCardHeader() {
  const { t } = useI18n();

  return (
    <div className="mb-8 flex items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-md border border-white/10 bg-zinc-900 shadow-[0_0_28px_rgba(34,197,94,0.35)]">
          <WalletCards className="size-7 text-green-300" aria-hidden="true" />
        </div>
        <div>
          <p className="text-2xl font-bold leading-none tracking-normal text-white">
            CatWallet
          </p>
          <p className="mt-1 text-xs font-medium uppercase text-green-300">
            {t("auth.kicker")}
          </p>
        </div>
      </div>
      <AuthLocaleSelect />
    </div>
  );
}
