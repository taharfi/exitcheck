import { test, expect } from "@playwright/test";
test("terminal research, paper approval, kill switch, persistence and exit preview", async ({
  page,
}) => {
  const now = Date.now();
  const market = {
    id: "poly:browser-test",
    providerId: "browser-test",
    question: "Will Solana reach $200?",
    category: "Crypto",
    source: "polymarket",
    dataProvider: "gamma",
    yesPrice: 0.6,
    noPrice: 0.4,
    volume24h: 20000,
    liquidity: 50000,
    resolutionDate: new Date(now + 86400000).toISOString(),
    rules: "YES if the stated reference reaches $200.",
    oracleSource: "Market resolution rules",
    url: "https://polymarket.com/event/test",
    tokenIds: ["123", "456"],
    capturedAt: now,
    tradable: true,
  };
  await page.route("**/api/trade", (route) =>
    route.fulfill({
      json: { markets: [market], warnings: [], capturedAt: now },
    }),
  );
  await page.route("**/api/trade/research", (route) =>
    route.fulfill({
      json: {
        marketId: market.id,
        fairProbability: 0.6,
        marketProbability: 0.6,
        edge: 0,
        confidence: 0.1,
        bullThesis: ["Market-implied prior only"],
        bearThesis: ["No independent evidence"],
        citations: [],
        whyThisCouldBeWrong: "New primary evidence would invalidate the prior.",
        proposedTrade: { action: "PASS", limitPrice: 0.6, kellyExposureUSD: 0 },
        mode: "heuristic",
        notice: "No AI evidence collected.",
        capturedAt: now,
        agents: [{ role: "Market prior", probability: 0.6 }],
        searchSuggestions: [],
      },
    }),
  );
  await page.route("**/api/trade/depth", (route) =>
    route.fulfill({
      json: {
        notice: "Live bid-depth estimate; fees unknown.",
        estimate: {
          requested: "10000000",
          fillable: "10000000",
          gross: "5900000",
          insufficient: false,
          averagePrice: "590000",
        },
      },
    }),
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/trade");
  await expect(
    page.getByRole("heading", { name: /ExitCheck Agent Terminal/ }),
  ).toBeVisible();
  const execute = page.getByRole("button", { name: "Execute Paper Order" });
  await expect(execute).toBeDisabled();
  await page.getByRole("button", { name: "Run AI Research" }).first().click();
  await expect(
    page.getByText("MARKET-PRIOR BASELINE · NO AI EVIDENCE"),
  ).toBeVisible();
  const approval = page.getByRole("checkbox", { name: /Human Approval Gate/ });
  await approval.check();
  await expect(execute).toBeEnabled();
  await page.getByLabel("Shares", { exact: true }).fill("12");
  await expect(approval).not.toBeChecked();
  await expect(execute).toBeDisabled();
  await page.getByLabel("Shares", { exact: true }).fill("10");
  await approval.check();
  await page.getByRole("switch", { name: /Emergency kill switch/ }).click();
  await expect(
    page.getByRole("button", { name: /Kill switch armed/ }),
  ).toBeDisabled();
  await page.getByRole("switch", { name: /Emergency kill switch/ }).click();
  await approval.check();
  await execute.click();
  await expect(
    page.getByText(
      "Paper order filled and saved on this browser. No real funds moved.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check Exit Liquidity" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Check Exit Liquidity" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check Exit Liquidity" }).click();
  await expect(page.getByText(/10 of 10 shares fillable/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Run AI Research" }).first().click();
  await expect(
    page.getByText("MARKET-PRIOR BASELINE · NO AI EVIDENCE"),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `test-results/trade-${test.info().project.name}.png`,
    fullPage: true,
  });
});
