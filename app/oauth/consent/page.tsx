import { redirect } from "next/navigation";

import {
  OAuthConsentCard,
  OAuthConsentError,
} from "@/components/auth/oauth-consent-card";
import {
  approveOAuthAuthorization,
  denyOAuthAuthorization,
} from "@/app/oauth/consent/actions";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AUTHORIZATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

function queryValue(
  params: Record<string, string | string[] | undefined>,
  name: string,
) {
  const value = params[name];
  return Array.isArray(value) ? value[0] : value;
}

export default async function OAuthConsentPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const params = await searchParams;
  const authorizationId = queryValue(params, "authorization_id");
  if (!authorizationId || !AUTHORIZATION_ID_PATTERN.test(authorizationId)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-900 p-6">
        <OAuthConsentError />
      </main>
    );
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    redirect(`/?oauth_authorization_id=${encodeURIComponent(authorizationId)}`);
  }

  const { data, error } =
    await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-900 p-6">
        <OAuthConsentError />
      </main>
    );
  }

  if ("redirect_url" in data) redirect(data.redirect_url);

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-900 p-6">
      <OAuthConsentCard
        approveAction={approveOAuthAuthorization}
        denyAction={denyOAuthAuthorization}
        details={{
          authorizationId: data.authorization_id,
          clientName: data.client.name,
          clientUri: data.client.uri,
          redirectUri: data.redirect_uri,
          scope: data.scope,
        }}
      />
    </main>
  );
}
