const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function assertLocalDemoTarget(target: string): void {
  let url: URL;

  try {
    url = new URL(target);
  } catch {
    throw new Error("Demo target must be a valid local loopback URL.");
  }

  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error("Demo target must use a local loopback host.");
  }
}

export function parseSupabaseStatusEnv(output: string): Record<string, string> {
  return Object.fromEntries(
    output
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf("=");
        if (separator < 1) {
          throw new Error("Unexpected Supabase status output.");
        }

        const key = line.slice(0, separator);
        const value = line.slice(separator + 1).replace(/^"|"$/gu, "");

        return [key, value];
      }),
  );
}
