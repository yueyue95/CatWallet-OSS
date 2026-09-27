import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CategoriesScreen } from "@/components/dashboard/categories-screen";
import type { CategoryOverviewItem } from "@/lib/finance/transactions";

vi.mock("@/components/dashboard/new-category-dialog", () => ({
  NewCategoryDialog: ({ children }: { children?: React.ReactNode }) => children,
}));
vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    formatCurrency: (value: number) => `RM${value.toFixed(2)}`,
    formatNumber: (value: number) => String(value),
    t: (key: string) => key,
  }),
}));

describe("CategoriesScreen", () => {
  it("does not show a delete action for a system category", () => {
    const category = {
      canModify: false,
      color: "#22c55e",
      group: "needs",
      icon: "🏠",
      id: "category-home",
      isDefault: true,
      label: "Housing",
      monthlyLimit: 0,
      name: "Housing",
      spent: 0,
    } satisfies CategoryOverviewItem;
    const markup = renderToStaticMarkup(
      <CategoriesScreen
        categories={[category]}
        createCategoryAction={vi.fn()}
        deleteCategoryAction={vi.fn()}
        updateCategoryAction={vi.fn()}
      />,
    );

    expect(markup).not.toContain('aria-label="common.delete"');
  });
});
