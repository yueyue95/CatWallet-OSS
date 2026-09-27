export function getSupabaseAuthStorageKey(supabaseUrl: string): string {
  const hostname = new URL(supabaseUrl).hostname.split(".")[0];
  return `sb-${hostname}-auth-token`;
}
