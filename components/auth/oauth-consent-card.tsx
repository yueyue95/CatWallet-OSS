"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

type ConsentAction = (formData: FormData) => Promise<void>;

export type OAuthConsentDetails = {
  authorizationId: string;
  clientName: string;
  clientUri: string;
  redirectUri: string;
  scope: string;
};

export function OAuthConsentCard({
  approveAction,
  denyAction,
  details,
}: Readonly<{
  approveAction: ConsentAction;
  denyAction: ConsentAction;
  details: OAuthConsentDetails;
}>) {
  const { t } = useI18n();
  const scopes = details.scope.split(/\s+/).filter(Boolean);

  return (
    <section className="w-full max-w-lg rounded-lg border border-white/10 bg-zinc-950/88 p-6 text-white shadow-2xl shadow-green-950/30 backdrop-blur md:p-8">
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          CatWallet
        </p>
        <h1 className="text-2xl font-bold tracking-normal">
          {t("oauth.consentTitle")}
        </h1>
        <p className="text-sm leading-6 text-zinc-300">
          {t("oauth.consentDescription")}
        </p>
      </div>

      <dl className="mt-6 space-y-4 text-sm">
        <div>
          <dt className="text-zinc-400">{t("oauth.consentRequestedBy")}</dt>
          <dd className="mt-1 font-medium text-white">{details.clientName}</dd>
          {details.clientUri ? (
            <dd className="mt-1 break-all text-xs text-zinc-400">
              {details.clientUri}
            </dd>
          ) : null}
        </div>

        <div>
          <dt className="text-zinc-400">{t("oauth.consentScopes")}</dt>
          <dd className="mt-2 flex flex-wrap gap-2">
            {scopes.length > 0 ? (
              scopes.map((scope) => (
                <span
                  className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200"
                  key={scope}
                >
                  {scope}
                </span>
              ))
            ) : (
              <span className="text-zinc-400">—</span>
            )}
          </dd>
        </div>

        <div>
          <dt className="text-zinc-400">{t("oauth.consentRedirect")}</dt>
          <dd className="mt-1 break-all text-xs text-zinc-300">
            {details.redirectUri}
          </dd>
        </div>
      </dl>

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <form action={denyAction}>
          <input
            name="authorization_id"
            type="hidden"
            value={details.authorizationId}
          />
          <Button className="w-full sm:w-auto" variant="outline" type="submit">
            {t("oauth.consentDeny")}
          </Button>
        </form>
        <form action={approveAction}>
          <input
            name="authorization_id"
            type="hidden"
            value={details.authorizationId}
          />
          <Button className="w-full sm:w-auto" type="submit">
            {t("oauth.consentApprove")}
          </Button>
        </form>
      </div>
    </section>
  );
}

export function OAuthConsentError() {
  const { t } = useI18n();

  return (
    <section className="w-full max-w-lg rounded-lg border border-white/10 bg-zinc-950/88 p-6 text-white shadow-2xl shadow-green-950/30 backdrop-blur md:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
        CatWallet
      </p>
      <h1 className="mt-3 text-2xl font-bold tracking-normal">
        {t("oauth.consentTitle")}
      </h1>
      <p className="mt-3 text-sm leading-6 text-zinc-300">
        {t("oauth.consentError")}
      </p>
      <Link
        className="mt-6 inline-flex text-sm text-primary underline underline-offset-4"
        href="/"
      >
        {t("auth.backToSignIn")}
      </Link>
    </section>
  );
}
