import { describe, expect, it } from "vitest";

import {
  DEMO_REFERENCE_DATE,
  DEMO_TIME_ZONE,
  demoFixtures,
  screenshotTargets,
} from "@/scripts/demo/fixtures";

describe("deterministic demo fixtures", () => {
  it("uses a fixed date, time zone, and clearly fictional accounts", () => {
    expect(DEMO_REFERENCE_DATE).toBe("2026-09-15T12:00:00+08:00");
    expect(DEMO_TIME_ZONE).toBe("Asia/Kuala_Lumpur");
    expect(demoFixtures.accounts.map((account) => account.name)).toEqual([
      "Everyday Account",
      "Demo Savings",
      "Demo Visa",
    ]);
  });

  it("covers the documented demo scenarios", () => {
    const labels = new Set(
      demoFixtures.transactions.map((transaction) => transaction.description),
    );

    expect([...labels]).toEqual(
      expect.arrayContaining([
        "Salary",
        "Rent",
        "Groceries",
        "Cat Food",
        "Coffee",
        "Books",
        "Weekend Trip",
      ]),
    );
    expect(demoFixtures.installments.some((item) => item.retired)).toBe(true);
    expect(demoFixtures.commitments).not.toHaveLength(0);
    expect(demoFixtures.sinkingFunds).not.toHaveLength(0);
    expect(demoFixtures.goals).not.toHaveLength(0);
    expect(demoFixtures.coolingItems).not.toHaveLength(0);
  });

  it("defines the ten required screenshot targets", () => {
    expect(screenshotTargets).toHaveLength(10);
    expect(screenshotTargets.map((target) => target.relativePath)).toEqual([
      "docs/images/demo/en/dashboard-desktop.png",
      "docs/images/demo/en/transactions-desktop.png",
      "docs/images/demo/en/reports-desktop.png",
      "docs/images/demo/en/planning-desktop.png",
      "docs/images/demo/en/dashboard-mobile.png",
      "docs/images/demo/zh-CN/dashboard-desktop.png",
      "docs/images/demo/zh-CN/transactions-desktop.png",
      "docs/images/demo/zh-CN/reports-desktop.png",
      "docs/images/demo/zh-CN/planning-desktop.png",
      "docs/images/demo/zh-CN/dashboard-mobile.png",
    ]);
  });
});
