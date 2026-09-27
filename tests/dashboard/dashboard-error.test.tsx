import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import DashboardError from "@/app/dashboard/error";

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("dashboard error state", () => {
  it("explains a load failure and offers retry", () => {
    const html = renderToStaticMarkup(<DashboardError retry={() => {}} />);
    expect(html).toContain("catwallet.loadError");
    expect(html).toContain("catwallet.retry");
  });
});
