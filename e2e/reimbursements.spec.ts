import { expect, test } from "./fixtures/authenticated-test";

test("records a reimbursement from the first-class mobile entry", async ({
  page,
}) => {
  const description = `E2E shared purchase ${Date.now()}`;

  await page.goto("/transactions");
  await page.getByRole("button", { name: "Add Transaction" }).click();
  const transactionDialog = page.getByRole("dialog");
  await transactionDialog.locator("#amount").pressSequentially("5000");
  await transactionDialog.getByRole("button", { name: /Food/ }).click();
  await transactionDialog.getByText("More options", { exact: true }).click();
  await transactionDialog
    .getByLabel("Description", { exact: true })
    .fill(description);
  await transactionDialog
    .getByRole("button", { name: "Cash", exact: true })
    .click();
  await transactionDialog
    .getByRole("button", { name: "Save transaction" })
    .click();
  await expect(page.getByText(description, { exact: true })).toBeVisible();

  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/transactions/new");
  await page.getByRole("button", { name: "Record reimbursement" }).click();

  const reimbursementDialog = page.getByRole("dialog");
  await reimbursementDialog
    .getByLabel("Find by date, merchant, amount, or account")
    .fill(description);
  await reimbursementDialog.getByLabel("Original expense").click();
  await page.getByRole("option", { name: new RegExp(description) }).click();
  await reimbursementDialog.getByLabel("Receiving account").click();
  await page.getByRole("option", { name: "Cash", exact: true }).click();
  await reimbursementDialog.getByLabel("How much?").fill("10.00");

  await expect(reimbursementDialog.getByText("Impact preview")).toBeVisible();
  const dialogBounds = await reimbursementDialog.boundingBox();
  expect(dialogBounds).not.toBeNull();
  expect(dialogBounds!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(390);

  await reimbursementDialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Reimbursement saved.")).toBeVisible();

  await page.goto("/transactions");
  await expect(page.getByText("Reimbursement", { exact: true })).toBeVisible();
});
