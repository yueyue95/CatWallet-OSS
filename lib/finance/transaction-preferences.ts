const LAST_CATEGORY_KEY = "catwallet-last-category";
const LAST_PAYMENT_METHOD_KEY = "catwallet-last-payment-method";

function read(key: string): string | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private browsing and blocked storage should not stop quick entry.
  }
}

export function getLastTransactionCategory(): string | null {
  return read(LAST_CATEGORY_KEY);
}

export function getLastTransactionPaymentMethod(): string | null {
  return read(LAST_PAYMENT_METHOD_KEY);
}

export function rememberLastTransactionCategory(categoryId: string): void {
  if (categoryId && categoryId !== "none") write(LAST_CATEGORY_KEY, categoryId);
}

export function rememberLastTransactionPaymentMethod(
  paymentMethodId: string,
): void {
  if (paymentMethodId && paymentMethodId !== "none") {
    write(LAST_PAYMENT_METHOD_KEY, paymentMethodId);
  }
}
