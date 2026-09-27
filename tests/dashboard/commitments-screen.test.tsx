import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CommitmentsScreen } from "@/components/catwallet/commitments-screen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    formatCurrency: (value: number) => `RM${value.toFixed(2)}`,
    t: (key: string) =>
      ({
        "catwallet.selectPaymentAccount": "请选择支付账户",
        "catwallet.selectCategory": "请选择分类",
      })[key] ?? key,
  }),
}));

describe("CommitmentsScreen", () => {
  it("requires explicit payment account and category selections", () => {
    const markup = renderToStaticMarkup(
      <CommitmentsScreen
        categories={[]}
        commitments={[]}
        createAction={vi.fn()}
        deleteAction={vi.fn()}
        paymentMethods={[]}
        recordPaymentAction={vi.fn()}
        updateAction={vi.fn()}
      />,
    );

    expect(markup).toContain("请选择支付账户");
    expect(markup).toContain("请选择分类");
    expect(markup.match(/<select required=/g)).toHaveLength(2);
  });
});
