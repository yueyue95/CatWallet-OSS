import { expect, test } from "./fixtures/authenticated-test";

test("starts each authenticated test with isolated user data", async ({
  page,
}) => {
  await page.goto("/payments");

  await expect(
    page.getByRole("heading", { name: "Payments & Subscriptions" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Payment details: E2E/ }),
  ).toHaveCount(0);
});
