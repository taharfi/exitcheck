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
    "Research the trade. Understand the exit.",
  );
  await expect(
    page.getByRole("region", { name: "Live market preview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Explore live markets" }),
  ).toHaveAttribute("href", "/trade");
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
  await expect(page.getByText(/No\. Agents assist research/)).toBeVisible();
  await page
    .getByRole("link", { name: "Compare paper strategies", exact: true })
    .click();
  await expect(page).toHaveURL(/\/experiments$/, { timeout: 60000 });
  await expect(page.getByLabel("What would you like to test?")).toBeVisible();
  expect(errors).toEqual([]);
});
