import { test, expect } from "@playwright/test";

test("Panta feed filter, attribution and paper safety on desktop/mobile", async ({
  page,
}, testInfo) => {
  const now = Date.now();
  const panta = {
    id: "panta:11111111111111111111111111111111",
    providerId: "11111111111111111111111111111111",
    question: "Test contract: Will SOL reach $200?",
    category: "Crypto",
    source: "solana",
    dataProvider: "panta",
    yesPrice: 0.52,
    noPrice: 0.48,
    volume24h: null,
    liquidity: null,
    resolutionDate: new Date(now + 7200000).toISOString(),
    tradingClosesAt: new Date(now + 3600000).toISOString(),
    rules: "Test-only resolution terms.",
    oracleSource: "See Panta market resolution rules",
    url: "https://panta.market",
    tokenIds: [],
    capturedAt: now,
    tradable: true,
  };
  const gamma = {
    ...panta,
    id: "poly:1",
    providerId: "1",
    dataProvider: "gamma",
    source: "polymarket",
    question: "Test Polymarket contract",
  };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/trade", (route) =>
    route.fulfill({
      json: { markets: [gamma, panta], warnings: [], capturedAt: now },
    }),
  );
  await page.route("**/api/trade/market?id=*", (route) =>
    route.fulfill({ json: panta }),
  );
  await page.goto("/trade");
  await page
    .getByRole("combobox", { name: /^Market feed/ })
    .selectOption("panta");
  await expect(
    page
      .getByRole("region", { name: "Live market feed" })
      .getByRole("heading", { name: gamma.question }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /PANTA \/ SOLANA/ }).click();
  await expect(page.getByText(/Real bonding-curve fills/)).toBeVisible();
  await expect(page.getByText(/Forecast’s market ID/)).toHaveCount(0);
  const no = page.getByRole("button", { name: "BUY NO", exact: true });
  await expect(no).toBeEnabled();
  await no.click();
  await expect(
    page.getByRole("button", { name: "Execute Paper Order" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "Powered by Panta", exact: true }).first(),
  ).toHaveAttribute("href", "https://panta.market");
  await page.getByRole("checkbox", { name: /Human Approval Gate/ }).check();
  await expect(
    page.getByRole("button", { name: "Execute Paper Order" }),
  ).toBeEnabled();
  await page.getByRole("switch", { name: /Emergency kill switch/ }).click();
  await expect(
    page.getByRole("button", { name: /Kill switch armed/ }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("panta-terminal.png"),
    fullPage: true,
  });
});
