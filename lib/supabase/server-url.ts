type SupabaseUrlEnvironment = Record<string, string | undefined>;

export function getSupabaseServerUrl(
  environment: SupabaseUrlEnvironment = process.env,
) {
  const serverUrl = environment.SUPABASE_SERVER_URL?.trim();
  return serverUrl || environment.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
}
