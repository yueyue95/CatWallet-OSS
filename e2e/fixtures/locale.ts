import type { Page } from "@playwright/test";

type SupportedLocale = "en" | "pt-BR" | "zh-CN";

export async function initializeLocale(
  page: Page,
  locale: SupportedLocale,
): Promise<void> {
  await page.addInitScript((nextLocale) => {
    window.localStorage.setItem("catwallet-locale", nextLocale);
  }, locale);
}
