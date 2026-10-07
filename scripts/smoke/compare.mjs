import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const base = process.env.COMPARE_BASE_URL ?? "http://127.0.0.1:3000";
const owners = [
  "E1Uc6BvyLS1cP47yuYq4sGQqbQPrrH6YKVuth88NzeHm",
  "782PjCvahP97LUL5KQ1rxzXWWExrcvMnemFxgn9LrfED",
];
const browser = await chromium.launch();
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
    });
    const page = await context.newPage(),
      errors = [],
      actions = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.url().includes("/api/actions")) actions.push(r.url());
    });
    await page.route("**/api/discover?*", (route) =>
      route.fulfill({
        json: {
          traders: owners.map((ownerPubkey) => ({
            ownerPubkey,
            realizedPnlUsd: "10000000",
            totalVolumeUsd: "100000000",
            predictionsCount: "30",
            correctPredictions: "20",
            wrongPredictions: "10",
            winRatePct: "66.67",
          })),
          activity: [],
          activityAvailable: true,
          retrievedAt: Date.now(),
          coverage: "Synthetic browser test only.",
        },
      }),
    );
    await page.route("**/api/compare?*", (route) => {
      const q = new URL(route.request().url()).searchParams;
      assert.deepEqual(q.getAll("owner"), owners);
      const result = {
        realizedPnl: "1000000",
        openCost: "5000000",
        openPositions: 1,
        cash: "196000000",
        realizedDrawdown: "0",
        copied: 1,
        skipped: 2,
        receipts: [],
      };
      return route.fulfill({
        json: {
          owners,
          budget: q.get("budget"),
          feeBps: 100,
          slippageBps: 100,
          from: 1790483754,
          to: 1790913792,
          commonWindow: true,
          coverage: owners.map((owner) => ({
            owner,
            events: 10,
            reportedTotal: 90,
            pages: 2,
            complete: false,
            stopReason: "Synthetic stalled cursor",
          })),
          individual: owners.map((owner) => ({ owner, ...result })),
          combined: result,
          overlap: {
            verified: false,
            coverage: owners.map((owner) => ({
              owner,
              complete: false,
              unknownEvents: 1,
              reason: "Synthetic unknown identity",
              openPositions: 2,
              at: Date.now(),
            })),
            groups: [
              {
                key: "market:test",
                title: "Synthetic shared event",
                owners,
                positions: 2,
                opposingSides: true,
                eventVerified: false,
                markedValue: null,
              },
            ],
          },
          warning: "Synthetic browser test only.",
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
      .getByRole("button", { name: /Save wallet/ })
      .first()
      .click();
    await page.reload();
    await page.getByRole("button", { name: /Saved wallet/ }).waitFor();
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("exitcheck-watchlist-v1")).length,
      ),
      1,
    );
    await page
      .getByRole("button", { name: /Add to comparison/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: /Add to comparison/ })
      .first()
      .click();
    await page.getByRole("link", { name: /Compare selected wallets/ }).click();
    await page.getByText("Your selection (2/3)").waitFor();
    await page.getByLabel("Virtual budget (USD)").fill("200");
    await page
      .getByRole("button", { name: "Compare and check overlap" })
      .click();
    await page.getByText("Each wallet, tested separately").waitFor();
    await page.getByText("Marked value unknown", { exact: true }).waitFor();
    assert.ok(
      (await page.locator("body").innerText()).includes(
        "opposing sides in the same market",
      ),
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: `docs/screenshots/compare-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("link", { name: "Start paper tracking" }).click();
    await page
      .getByRole("button", { name: "Start paper portfolio - 2/3 selected" })
      .click();
    await page.getByText("Available virtual cash").waitFor();
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("exitcheck-paper-v1")),
    );
    assert.deepEqual(saved.owners, owners);
    assert.equal(saved.cash, "200000000");
    await page.goto(base + "/paper?wallet=" + owners[0] + "&budget=500");
    await page.getByText("Available virtual cash").waitFor();
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("exitcheck-paper-v1")).cash,
      ),
      "200000000",
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(actions, []);
    await context.close();
    console.log(
      `Comparison workflow passed at ${width}px: saved watchlist, selection, unknown overlap, shared budget, paper handoff, existing portfolio preserved.`,
    );
  }
} finally {
  await browser.close();
}
