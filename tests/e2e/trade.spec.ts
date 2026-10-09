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
  let depthChecks = 0;
  await page.route("**/api/trade/depth", (route) => {
    depthChecks++;
    return route.fulfill({
      json: {
        marketId: market.id,
        side: "YES",
        notice: "Live bid-depth estimate; fees unknown.",
        estimate: {
          requested: "10000000",
          fillable: depthChecks === 1 ? "4000000" : "10000000",
          gross: depthChecks === 1 ? "2360000" : "5900000",
          insufficient: depthChecks === 1,
          capturedAt: depthChecks === 2 ? Date.now() - 21000 : Date.now(),
          averagePrice: "590000",
        },
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/trade");
  await expect(
    page.getByRole("heading", { name: /ExitCheck Agent Terminal/ }),
  ).toBeVisible();
  const execute = page.getByRole("button", { name: "Execute Paper Order" });
  await expect(execute).toBeDisabled();
  await expect(page.getByText("Risk & exit checks", { exact: true })).toBeVisible();
  await page.getByText("Risk & exit checks", { exact: true }).click();
  const review = page.getByRole("region", { name: "Check this trade" });
  await expect(
    review.getByText("Wait for evidence", { exact: true }),
  ).toBeVisible();
  await expect(review.getByText("Unknown · excluded")).toBeVisible();
  await review
    .getByRole("button", { name: "Check current exit liquidity" })
    .click();
  await expect(review.getByText(/4 of 10 shares covered/)).toBeVisible();
  await expect(
    review.getByText(/Insufficient depth for a full exit/),
  ).toBeVisible();
  await review
    .getByRole("button", { name: "Check current exit liquidity" })
    .click();
  await expect(review.getByText(/Exit snapshot expired/)).toBeVisible();
  await expect(review.getByText("$5.90 gross", { exact: true })).toHaveCount(0);
  await review
    .getByRole("button", { name: "Check current exit liquidity" })
    .click();
  await expect(review.getByText("$5.90 gross", { exact: true })).toBeVisible();
  await page.getByLabel("Shares", { exact: true }).fill("12");
  await expect(review.getByText("$5.90 gross", { exact: true })).toHaveCount(0);
  await expect(
    review.getByText(/Exit capacity has not been checked/),
  ).toBeVisible();
  await page.getByLabel("Shares", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Run AI Research" }).first().click();
  await expect(page.getByText(/AI research unavailable\./)).toBeVisible();
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
  await page.getByText(/Paper journal & backups/).click();
  await page.getByRole("button", { name: "Preview paper close" }).click();
  await expect(
    page.getByText(/10 of 10 shares can be paper-closed/),
  ).toBeVisible();
  await page
    .getByRole("checkbox", {
      name: "I approve this paper close or settlement.",
    })
    .check();
  await page.getByRole("button", { name: "Record paper action" }).click();
  await expect(
    page.getByRole("button", { name: "Preview paper close" }),
  ).toHaveCount(0);
  await expect(page.locator("#paper-journal tbody tr")).toHaveCount(1);
  await page.reload();
  await page.getByText(/Paper journal & backups/).click();
  await expect(page.locator("#paper-journal tbody tr")).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Run AI Research" }).first().click();
  await expect(page.getByText(/AI research unavailable\./)).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `test-results/trade-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("DeepSeek rules analysis does not display unsupported forecasts", async ({
  page,
}) => {
  const now = Date.now();
  const market = {
    id: "poly:deepseek-browser",
    providerId: "deepseek-browser",
    question: "Will the stated event occur?",
    category: "Other",
    source: "polymarket",
    dataProvider: "gamma",
    yesPrice: 0.6,
    noPrice: 0.4,
    volume24h: null,
    liquidity: null,
    resolutionDate: new Date(now + 86400000).toISOString(),
    rules: "YES if the event occurs.",
    oracleSource: "Market rules",
    url: "https://polymarket.com/event/test",
    tokenIds: [],
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
        mode: "deepseek",
        fairProbability: 0.6,
        marketProbability: 0.6,
        edge: 0,
        confidence: 0,
        bullThesis: ["The event must meet the stated rules."],
        bearThesis: ["The event might fail the resolution conditions."],
        whyThisCouldBeWrong: "The rules could be incomplete.",
        citations: [],
        proposedTrade: { action: "PASS", limitPrice: 0.6, kellyExposureUSD: 0 },
        capturedAt: now,
        agents: [],
        searchSuggestions: [],
        notice:
          "DeepSeek analyses supplied rules only; no independent evidence.",
      },
    }),
  );
  await page.goto("/trade");
  await page.getByRole("button", { name: "Run AI Research" }).first().click();
  await expect(
    page.getByText("DEEPSEEK / MARKET RULES ANALYSIS"),
  ).toBeVisible();
  await expect(page.getByText("The event must meet the stated rules.")).toBeHidden();
  await page.getByText(/Evidence & analysis details/).click();
  await expect(
    page.getByText("The event must meet the stated rules."),
  ).toBeVisible();
  await expect(page.getByText("The rules could be incomplete.")).toBeVisible();
  await expect(page.getByText("FAIR PROBABILITY", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("ESTIMATED EDGE", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page
      .getByRole("region", { name: "Trading takeaway" })
      .getByRole("heading", { name: "Wait", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Execute Paper Order" }),
  ).toBeDisabled();
});

test("large catalogs load more cards and search beyond the visible first page", async ({
  page,
}) => {
  const now = Date.now();
  const markets = Array.from({ length: 130 }, (_, i) => ({
    id: `poly:catalog-${i}`,
    providerId: `catalog-${i}`,
    question: `Catalog contract ${i}`,
    category: "Other",
    source: "polymarket",
    dataProvider: "gamma",
    yesPrice: 0.6,
    noPrice: 0.4,
    volume24h: null,
    liquidity: null,
    resolutionDate: new Date(now + 86400000).toISOString(),
    rules: "YES if the event occurs.",
    oracleSource: "Market rules",
    url: "https://polymarket.com/event/test",
    tokenIds: [],
    capturedAt: now,
    tradable: true,
  }));
  await page.route("**/api/trade", (route) =>
    route.fulfill({ json: { markets, warnings: [], capturedAt: now } }),
  );
  await page.goto("/trade");
  const feed = page.getByRole("region", { name: "Live market feed" });
  await expect(feed.locator("article")).toHaveCount(50);
  await page.getByRole("button", { name: /Load 50 more markets/ }).click();
  await expect(feed.locator("article")).toHaveCount(100);
  await page.getByRole("button", { name: /Load 50 more markets/ }).click();
  await expect(feed.locator("article")).toHaveCount(130);
  await expect(
    page.getByRole("button", { name: /Load 50 more markets/ }),
  ).toHaveCount(0);
  await page.getByLabel("Search markets").fill("contract 129");
  await expect(feed.locator("article")).toHaveCount(1);
  await expect(
    feed.getByRole("heading", { name: "Catalog contract 129", exact: true }),
  ).toBeVisible();
});

test("supported paper NO verdict selects a side without approving an order", async ({
  page,
}) => {
  const now = Date.now();
  const market = {
    id: "poly:no-verdict",
    providerId: "no-verdict",
    question: "Will the stated event occur?",
    category: "Other",
    source: "polymarket",
    dataProvider: "gamma",
    yesPrice: 0.6,
    noPrice: 0.4,
    volume24h: null,
    liquidity: null,
    resolutionDate: new Date(now + 86400000).toISOString(),
    rules: "YES if the event occurs.",
    oracleSource: "Market rules",
    url: "https://polymarket.com/event/test",
    tokenIds: [],
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
        mode: "gemini",
        fairProbability: 0.2,
        marketProbability: 0.6,
        edge: -0.4,
        confidence: 0.7,
        bullThesis: ["Bull"],
        bearThesis: ["Bear"],
        whyThisCouldBeWrong: "New evidence could change the estimate.",
        nextCheck: "Review the two primary sources.",
        citations: [1, 2].map((i) => ({
          title: `Source ${i}`,
          source: "Primary",
          url: `https://example.com/${i}`,
          summary: "Evidence",
          reliability: 0.7,
        })),
        proposedTrade: {
          action: "BUY_NO",
          limitPrice: 0.4,
          kellyExposureUSD: 100,
        },
        capturedAt: now,
        agents: [],
        searchSuggestions: [],
        notice: "Model estimates are not verified probabilities.",
      },
    }),
  );
  await page.goto("/trade");
  await page.getByRole("button", { name: "Run AI Research" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Consider paper NO", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review paper NO order", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "BUY NO", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("checkbox", { name: /Human Approval Gate/ }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Execute Paper Order" }),
  ).toBeDisabled();
});
