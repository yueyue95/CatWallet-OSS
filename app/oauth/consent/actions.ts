"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

const AUTHORIZATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

function readAuthorizationId(formData: FormData) {
  const value = formData.get("authorization_id");
  if (typeof value !== "string" || !AUTHORIZATION_ID_PATTERN.test(value)) {
    return null;
  }
  return value;
}

function consentPath(authorizationId: string, error?: string) {
  const query = new URLSearchParams({ authorization_id: authorizationId });
  if (error) query.set("error", error);
  return `/oauth/consent?${query.toString()}`;
}

async function decideAuthorization(
  formData: FormData,
  decision: "approve" | "deny",
) {
  const authorizationId = readAuthorizationId(formData);
  if (!authorizationId) redirect("/?auth_error=oauth_invalid_request");

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    redirect(`/?oauth_authorization_id=${encodeURIComponent(authorizationId)}`);
  }

  const result =
    decision === "approve"
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, {
          skipBrowserRedirect: true,
        })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, {
          skipBrowserRedirect: true,
        });

  if (result.error || !result.data?.redirect_url) {
    redirect(consentPath(authorizationId, "decision_failed"));
  }

  redirect(result.data.redirect_url);
}

export async function approveOAuthAuthorization(formData: FormData) {
  await decideAuthorization(formData, "approve");
}

export async function denyOAuthAuthorization(formData: FormData) {
  await decideAuthorization(formData, "deny");
}
