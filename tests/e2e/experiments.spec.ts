import { test, expect } from "@playwright/test";
test("previews a paper plan without authorizing orders and fits the viewport", async ({
  page,
}) => {
  await page.route("**/api/experiments", (route) =>
    route.fulfill({ json: { signedIn: false, experiments: [] } }),
  );
  await page.goto("/experiments");
  await page.getByRole("button", { name: "Preview plan" }).click();
  await expect(
    page.getByRole("heading", { name: "$300.00 for 7 days" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve & start paper experiment" }),
  ).toBeDisabled();
  await page
    .getByLabel("What would you like to test?")
    .fill("Buy live with $300");
  await page.getByRole("button", { name: "Preview plan" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Include a budget" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
