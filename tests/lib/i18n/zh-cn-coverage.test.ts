import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import zhCNMessages from "@/lib/i18n/zh-CN";

const mainFlowSources = [
  "components/dashboard/catwallet-summary.tsx",
  "components/dashboard/transaction-form.tsx",
  "components/dashboard/transactions-screen.tsx",
  "components/catwallet/installments-screen.tsx",
  "components/catwallet/sinking-funds-screen.tsx",
  "components/dashboard/payments-screen.tsx",
  "components/dashboard/payment-methods-tab.tsx",
  "components/dashboard/subscriptions-tab.tsx",
  "components/dashboard/new-payment-method-dialog.tsx",
  "components/dashboard/categories-screen.tsx",
  "components/catwallet/commitments-screen.tsx",
  "components/dashboard/budgets-screen.tsx",
  "components/dashboard/goals-screen.tsx",
  "components/dashboard/reports-screen.tsx",
  "components/dashboard/settings-screen.tsx",
];

function staticTranslationKeys(source: string) {
  return [...source.matchAll(/\bt\("([^"]+)"/g)].map((match) => match[1]);
}

describe("zh-CN main flow coverage", () => {
  it("has an explicit Simplified Chinese message for every static main-flow key", () => {
    const missing = mainFlowSources.flatMap((relativePath) => {
      const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
      return staticTranslationKeys(source)
        .filter((key) => !zhCNMessages[key])
        .map((key) => `${relativePath}: ${key}`);
    });

    expect(missing).toEqual([]);
  });

  it("uses the agreed payment-account terminology", () => {
    expect(zhCNMessages["transaction.paymentMethod"]).toBe("支付账户");
    expect(zhCNMessages["payments.details.paymentMethod"]).toBe("支付账户");
    expect(zhCNMessages["transaction.creditCardInvoice"]).toBe("信用卡账单");
    expect(zhCNMessages["payments.closingDay"]).toBe("结账日");
    expect(zhCNMessages["payments.dueDay"]).toBe("到期还款日");
    expect(zhCNMessages["common.close"]).toBe("关闭");
  });

  it("contains the requested payments-page empty states and dialog copy", () => {
    expect(zhCNMessages["payments.monthlyDueTitle"]).toBe("本月待付款");
    expect(zhCNMessages["payments.noInvoices"]).toBe("本月没有待付信用卡账单");
    expect(zhCNMessages["payments.noSubscriptions"]).toBe("本月没有待付订阅");
    expect(zhCNMessages["payments.noBills"]).toBe("本月没有待付账单");
    expect(zhCNMessages["paymentMethod.create"]).toBe("新增支付账户");
    expect(zhCNMessages["transaction.saveChanges"]).toBe("保存修改");
  });
});
