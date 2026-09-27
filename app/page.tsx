import { redirect } from "next/navigation";

import { LandingContent } from "@/components/landing/landing-content";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage({
  searchParams,
}: Readonly<{
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const params = (await searchParams) ?? {};
  const authorizationId = Array.isArray(params.oauth_authorization_id)
    ? params.oauth_authorization_id[0]
    : params.oauth_authorization_id;
  const afterAuthPath = authorizationId
    ? `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`
    : undefined;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (data?.claims) {
    redirect(afterAuthPath ?? "/dashboard");
  }

  return <LandingContent afterAuthPath={afterAuthPath} />;
}
