import { test, expect } from "@playwright/test";

test("landing explains the example and opens the app without leaking the sidebar layout", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveTitle("ExitCheck — Clarity before you act");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Know your position. Understand your exit.",
  );
  await expect(
    page.getByText("Illustrative example", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "25%", exact: true }).click();
  await expect(page.getByText("$16.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "50%", exact: true }).click();
  await expect(page.getByText("$31.50", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "100%", exact: true }).click();
  await expect(page.getByText("$60.50", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page
    .getByRole("link", { name: "Check my positions", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 60000 });
  await expect(
    page.getByLabel("Wallet address", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Positions & exits", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "ExitCheck home", exact: true }).click();
  await expect(page).toHaveURL(/:3001\/$/, { timeout: 60000 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(() => getComputedStyle(document.body).paddingLeft),
  ).toBe("0px");
  await page
    .locator("summary")
    .filter({ hasText: "Does ExitCheck automatically trade for me?" })
    .click();
  await expect(
    page.getByText(/No\. This version focuses on position lookup/),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Explore research tools", exact: true })
    .click();
  await expect(page).toHaveURL(/\/research$/, { timeout: 60000 });
  await expect(page.getByLabel("Virtual budget (USD)")).toBeVisible();
  expect(errors).toEqual([]);
});
