export type CurrencyCode = "BRL" | "USD" | "EUR" | "MYR";

export const DEFAULT_CURRENCY: CurrencyCode = "MYR";
export const CURRENCY_STORAGE_KEY = "catwallet-currency";

const supportedCurrencies = new Set<CurrencyCode>(["BRL", "USD", "EUR", "MYR"]);
export function isSupportedCurrency(value: unknown): value is CurrencyCode {
  return supportedCurrencies.has(value as CurrencyCode);
}

export function getStoredCurrency(): CurrencyCode {
  if (typeof window === "undefined") return DEFAULT_CURRENCY;
  try {
    const stored = window.localStorage.getItem(CURRENCY_STORAGE_KEY);
    if (stored && isSupportedCurrency(stored)) return stored;
  } catch {}
  return DEFAULT_CURRENCY;
}

export function setStoredCurrency(currency: CurrencyCode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CURRENCY_STORAGE_KEY, currency);
  } catch {}
}

export function getCurrencySymbol(
  currency: CurrencyCode,
  locale: string,
): string {
  const part = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  })
    .formatToParts(0)
    .find(({ type }) => type === "currency");

  return part?.value ?? currency;
}

export function formatCurrency(
  amount: number,
  locale: string,
  currency: CurrencyCode,
): string {
  if (currency === "MYR") {
    return new Intl.NumberFormat("en-MY", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
      .format(amount)
      .replaceAll("\u00a0", " ");
  }
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
