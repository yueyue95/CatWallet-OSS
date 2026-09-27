import { expect, test } from "./fixtures/authenticated-test";

test.describe("dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
  });

  test("renders the safe-to-spend summary", async ({ page }) => {
    const summary = page.getByRole("region", {
      name: "Safe to spend this month",
    });

    await expect(summary).toBeVisible();
    await expect(
      summary.getByRole("link", { name: /Cash and deposits/ }),
    ).toBeVisible();
    await expect(
      summary.getByRole("link", { name: /Credit card balance due/ }),
    ).toBeVisible();
    await expect(summary.getByText("Net funds after card debt")).toBeVisible();
  });

  test("navigates through every sidebar section", async ({ page }) => {
    test.setTimeout(45_000);

    const sections: Array<
      [name: string, path: string, location: "primary" | "more"]
    > = [
      ["Transactions", "/transactions", "primary"],
      ["Categories", "/categories", "more"],
      ["Budgets", "/budgets", "more"],
      ["Payments", "/payments", "more"],
      ["Reports", "/reports", "more"],
      ["Goals", "/goals", "more"],
      ["Settings", "/settings", "more"],
      ["Overview", "/dashboard", "primary"],
    ];

    for (const [name, path, location] of sections) {
      if (location === "more") {
        await page.getByRole("button", { name: "More", exact: true }).click();
        await page.getByRole("menuitem", { name, exact: true }).click();
      } else {
        await page.getByRole("link", { name, exact: true }).click();
      }
      await page.waitForURL((url) => url.pathname === path);
      expect(new URL(page.url()).pathname).toBe(path);
    }
  });
});
