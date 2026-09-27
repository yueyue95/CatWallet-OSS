import { describe, expect, it } from "vitest";
import zhCNMessages from "@/lib/i18n/zh-CN";
import { formatCurrency } from "@/lib/i18n/currency";

describe("dashboard and report labels", () => {
  it("names transaction flows and cumulative results without claiming account assets", () => {
    expect(zhCNMessages["screen.reports.longTermSavings"]).toBe("储蓄投入");
    expect(zhCNMessages["screen.reports.longTermSavingsMetric"]).toBe(
      "本月储蓄投入",
    );
    expect(zhCNMessages["screen.reports.netWorth"]).toBe("累计收支结余");
    expect(zhCNMessages["screen.reports.netWorthTrend"]).toBe(
      "累计收支结余趋势",
    );
    expect(zhCNMessages["catwallet.spent"]).toBe("本月实际支出");
    expect(zhCNMessages["catwallet.incomeUsed"]).toBe("安心可花计入收入");
    expect(zhCNMessages["nav.cooling"]).toBe("想买清单");
  });

  it("shows MYR in one readable format across supported locales", () => {
    for (const locale of ["zh-CN", "en", "pt-BR"]) {
      expect(formatCurrency(1234.56, locale, "MYR")).toBe("RM 1,234.56");
    }
  });
});
