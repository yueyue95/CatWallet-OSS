export const DEFAULT_MCP_TIME_ZONE = "Asia/Kuala_Lumpur";

export function resolveMcpTimeZone(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return environment.CATWALLET_MCP_TIME_ZONE?.trim() || DEFAULT_MCP_TIME_ZONE;
}

export function monthInTimeZone(instant: Date, timeZone: string) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      month: "2-digit",
      timeZone,
      year: "numeric",
    }).formatToParts(instant);
  } catch {
    throw new Error(`Invalid CatWallet MCP timezone: ${timeZone}`);
  }

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) {
    throw new Error(`Invalid CatWallet MCP timezone: ${timeZone}`);
  }
  return `${year}-${month}`;
}

export function addMonths(month: string, count: number) {
  const date = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + count),
  );
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
