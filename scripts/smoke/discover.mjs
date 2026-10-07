import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const base = process.env.DISCOVER_BASE_URL ?? "http://127.0.0.1:3000";
const owners = [
  "E1Uc6BvyLS1cP47yuYq4sGQqbQPrrH6YKVuth88NzeHm",
  "782PjCvahP97LUL5KQ1rxzXWWExrcvMnemFxgn9LrfED",
  "DVHD66wYT5wFcgJ9K2SbtJTmbsJxzz6chkAzNwzbksdT",
];
const row = (owner, i) => ({
  ownerPubkey: owner,
  realizedPnlUsd: i === 2 ? "-1000000" : "10000000",
  totalVolumeUsd: "100000000",
  predictionsCount: i === 1 ? "2" : "30",
  correctPredictions: "20",
  wrongPredictions: "10",
  winRatePct: "66.67",
  period: "monthly",
  periodStart: "2026-10-01T00:00:00Z",
  periodEnd: "2026-11-01T00:00:00Z",
});
const browser = await chromium.launch();
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport }),
      page = await context.newPage(),
      errors = [],
      requests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => requests.push(r.url()));
    await page.route("**/api/discover?*", (route) => {
      const url = new URL(route.request().url());
      return route.fulfill({
        json: url.searchParams.has("owner")
          ? {
              profile: {
                ownerPubkey: owners[0],
                realizedPnlUsd: "20000000",
                totalVolumeUsd: "100000000",
                totalPositionsValueUsd: "5000000",
                totalActiveContractsMicro: "10000000",
                predictionsCount: "30",
                correctPredictions: "20",
                wrongPredictions: "10",
              },
            }
          : {
              traders: owners.map(row),
              activity: [],
              activityAvailable: true,
              retrievedAt: Date.now(),
              coverage: "Synthetic browser test only.",
            },
      });
    });
    await page.route("**/api/backtest?*", (route) => {
      const url = new URL(route.request().url());
      assert.equal(url.searchParams.getAll("owner").length, 1);
      return route.fulfill({
        json: {
          coverage: [
            {
              events: 10,
              complete: false,
              stopReason: "Synthetic partial history",
            },
          ],
          from: 1790483754,
          to: 1790913792,
          budget: "100000000",
          feeBps: 100,
          slippageBps: 100,
          results: [
            {
              strategy: "Small entries",
              realizedPnl: "10000000",
              cash: "80000000",
              openCost: "30000000",
              openPositions: 2,
              modeledFees: "1000000",
              copied: 3,
              skipped: 2,
              receipts: [
                {
                  at: 1790483754,
                  title: "Synthetic trade",
                  decision: "Skipped",
                  reason: "Budget limit",
                },
              ],
            },
          ],
        },
      });
    });
    await page.route("**/api/paper?*", (route) =>
      route.fulfill({
        json: {
          traders: [],
          trades: [],
          quotes: [],
          quoteErrors: [],
          retrievedAt: Date.now(),
          coverage: "Synthetic browser test only.",
        },
      }),
    );
    await page.goto(base + "/discover");
    await page
      .getByRole("button", { name: /^Simulate copying/ })
      .first()
      .waitFor();
    assert.equal(
      await page.getByRole("button", { name: /^Simulate copying/ }).count(),
      1,
    );
    await page.getByLabel("Minimum predictions").fill("0");
    assert.equal(
      await page.getByRole("button", { name: /^Simulate copying/ }).count(),
      2,
    );
    await page.getByLabel("Search wallet").fill(owners[0].slice(0, 6));
    assert.equal(
      await page.getByRole("button", { name: /^Simulate copying/ }).count(),
      1,
    );
    await page.getByRole("button", { name: /^Simulate copying/ }).click();
    await page.getByRole("button", { name: "Run simulation" }).click();
    await page
      .getByRole("heading", { name: "$10.00 realized modeled P&L" })
      .waitFor();
    await page
      .getByText("Incomplete historical coverage", { exact: true })
      .waitFor();
    await page.getByText("2 unvalued positions", { exact: true }).waitFor();
    const agentLink = new URL(
      await page
        .getByRole("link", { name: "Set up a copy agent", exact: true })
        .getAttribute("href"),
      base,
    );
    assert.equal(agentLink.searchParams.get("trader"), owners[0]);
    assert.equal(
      agentLink.searchParams.get("budget"),
      await page
        .getByLabel("Starting budget (USD)", { exact: true })
        .inputValue(),
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: "docs/screenshots/discover-" + viewport.width + ".png",
      fullPage: true,
    });
    await page.getByRole("link", { name: "Follow with virtual funds" }).click();
    await page
      .getByRole("button", { name: "Start paper portfolio - 1/3 selected" })
      .waitFor();
    await page
      .getByRole("button", { name: "Start paper portfolio - 1/3 selected" })
      .click();
    await page.getByText("Observing", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("exitcheck-paper-v1")).owners.length,
      ),
      1,
    );
    assert.equal(
      requests.some((url) => url.includes("/api/actions")),
      false,
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "Discover checks passed: " +
        viewport.width +
        "px, filters, profile, single simulation, coverage, open cost and paper handoff.",
    );
  }
  if (process.env.SMOKE_LIVE_READS === "true") {
    const r = await fetch(base + "/api/discover?period=monthly"),
      j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j.error));
    assert.ok(j.traders.length > 0);
    const owner = j.traders[0].ownerPubkey;
    const p = await fetch(base + "/api/discover?owner=" + owner),
      profile = await p.json();
    assert.equal(p.status, 200, JSON.stringify(profile.error));
    assert.equal(profile.profile.ownerPubkey, owner);
    console.log(
      "Live Discover data passed: " +
        j.traders.length +
        " ranked wallets and verified profile.",
    );
  }
} finally {
  await browser.close();
}
