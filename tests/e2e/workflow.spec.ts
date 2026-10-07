import { test, expect } from "@playwright/test";
test("overview carries a valid personal budget into comparison and keeps advanced tools accessible", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/research");
  await expect(
    page.getByRole("heading", { name: "Would copying them work for you?" }),
  ).toBeVisible();
  await page.getByLabel("Virtual budget (USD)").fill("5");
  await expect(
    page.getByRole("button", { name: "Test my budget" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "$500", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page
    .locator(".overview-budget")
    .getByRole("link", { name: "Test my budget" })
    .click();
  await expect(page).toHaveURL(/\/compare\?budget=500$/, { timeout: 60000 });
  await expect(page.getByLabel("Virtual budget (USD)")).toHaveValue("500");
  await page.getByRole("link", { name: "Advanced tools", exact: true }).click();
  await expect(page).toHaveURL(/\/lab$/, { timeout: 60000 });
  await expect(
    page.getByRole("heading", { name: "Market signal research" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
});
test("fixture lookup, size-aware preview, insufficient depth and honest review", async ({
  page,
}, testInfo) => {
  await page.goto("/exit");
  await expect(
    page.getByText("Development fixtures", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Load sample positions" }).click();
  await expect(
    page.getByText("Will the city approve its transit expansion?", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check exit" }).click();
  await expect(
    page.getByText("Insufficient depth for this size"),
  ).toBeVisible();
  await page.getByRole("button", { name: "25%", exact: true }).click();
  await expect(page.locator(".proceeds-number")).toHaveText("$20.10");
  await page.getByRole("button", { name: "50%", exact: true }).click();
  await expect(page.locator(".proceeds-number")).toHaveText("$39.60");
  await page.getByRole("button", { name: "Review fixture estimate" }).click();
  await expect(
    page.getByText("No transaction exists", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to preview" }).click();
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-preview.png`,
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.getByRole("button", { name: "All positions" }).click();
  await page.getByRole("button", { name: "View claim" }).click();
  await expect(
    page.getByText("Your winning position can be claimed."),
  ).toBeVisible();
  await expect(page.locator(".proceeds-number")).toHaveText("$45.00");
  await page.getByRole("button", { name: "All positions" }).click();
  await page.getByRole("button", { name: "View details" }).nth(2).click();
  await expect(
    page.getByText("This position cannot be verified for an exit."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review fixture estimate" }),
  ).toHaveCount(0);
});
test("synthetic partial-fill action survives browser refresh without a new preparation", async ({
  page,
}) => {
  const action = {
    id: "fixture-recovery-id",
    token: "a".repeat(64),
    owner: "11111111111111111111111111111111",
    positionId: "fixture-open",
    kind: "sell",
    quantity: "60000000",
    status: "partially-filled",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: Date.now() - 1,
    transaction: "",
    blockhash: "",
    lastValidBlockHeight: 1,
    orderId: "fixture-order",
    signature: "fixture-signature",
    actualReceived: null,
    providerStatus: "partiallyfilled",
    expectedGross: "39600000",
    estimatedFee: null,
    expectedNet: null,
    minSellPrice: "600000",
    networkFee: "5000",
    asset: "Fixture only",
    programs: [],
    accounts: [],
    simulation: "Synthetic fixture — no live simulation",
    signingEnabled: false,
  };
  let newPreparations = 0;
  await page.route("**/api/actions", (route) => {
    newPreparations++;
    return route.fulfill({ status: 409, body: "{}" });
  });
  await page.route("**/api/actions/fixture-recovery-id", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(action),
    }),
  );
  await page.addInitScript(
    ({ id, token }) =>
      localStorage.setItem("exitcheck-action", JSON.stringify({ id, token })),
    { id: action.id, token: action.token },
  );
  await page.goto("/exit");
  await expect(
    page.getByRole("heading", { name: "Partially filled", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Actual received amount is not yet verified."),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Partially filled", exact: true }),
  ).toBeVisible();
  expect(newPreparations).toBe(0);
});
test("synthetic wallet rejection is displayed as rejected, never confirmed", async ({
  page,
}) => {
  await page.route("**/api/actions/fixture-rejected", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "fixture-rejected",
        token: "a".repeat(64),
        owner: "11111111111111111111111111111111",
        positionId: "fixture-open",
        kind: "sell",
        quantity: "1000000",
        status: "rejected",
        programs: [],
        accounts: [],
        expectedNet: null,
        estimatedFee: null,
        minSellPrice: null,
        networkFee: null,
        asset: "Fixture only",
        actualReceived: null,
        providerStatus: null,
        simulation: "Not run",
        signingEnabled: false,
      }),
    }),
  );
  await page.addInitScript(() =>
    localStorage.setItem(
      "exitcheck-action",
      JSON.stringify({ id: "fixture-rejected", token: "a".repeat(64) }),
    ),
  );
  await page.goto("/exit");
  await expect(
    page.getByRole("heading", { name: "Rejected by user" }),
  ).toBeVisible();
  await expect(
    page.getByText("No transaction submitted", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Actual received amount is not yet verified."),
  ).toBeVisible();
});
test("service failures do not show fixture success or balances", async ({
  page,
}) => {
  await page.route("**/api/positions?*", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          message: "Jupiter rate limit reached.",
          requestId: "fixture-request-id",
        },
      }),
    }),
  );
  await page.goto("/exit");
  await page.getByRole("button", { name: "Load sample positions" }).click();
  await expect(page.locator('.notice[role="alert"]')).toContainText(
    "rate limit",
  );
  await expect(page.getByRole("table")).toHaveCount(0);
});
test("entry layout and explanation at desktop and mobile", async ({
  page,
}, testInfo) => {
  await page.goto("/exit");
  await expect(
    page.getByRole("heading", { name: "Know what comes back." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "How it works" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Back to workspace" }).click();
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-entry.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
});
