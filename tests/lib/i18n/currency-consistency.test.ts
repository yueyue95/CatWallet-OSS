import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { formatCurrency } from "@/lib/i18n/currency";

const sourcePaths = [
  "components/dashboard/summary-cards.tsx",
  "components/dashboard/transactions-screen.tsx",
  "components/dashboard/transaction-form.tsx",
  "components/dashboard/budgets-screen.tsx",
  "components/dashboard/reports-screen.tsx",
  "components/dashboard/expenses-over-time-chart.tsx",
  "components/dashboard/budget-progress.tsx",
].map((relativePath) => resolve(process.cwd(), relativePath));

describe("CatWallet currency source of truth", () => {
  it("formats MYR as RM with two decimals", () => {
    expect(formatCurrency(14, "zh-CN", "MYR").replaceAll("\u00a0", " ")).toBe(
      "RM 14.00",
    );
  });

  it("does not keep transaction and chart-level BRL formatting fallbacks", () => {
    for (const path of sourcePaths) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toContain("R$");
      expect(source).not.toContain('currency = "BRL"');
      expect(source).not.toContain('locale = "pt-BR"');
    }
  });

  it("keeps the five user-facing money surfaces on the i18n formatter", () => {
    const userFacingPaths = sourcePaths.slice(0, 5);

    for (const path of userFacingPaths) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("useI18n");
      expect(source).not.toContain("new Intl.NumberFormat");
    }
  });
});
