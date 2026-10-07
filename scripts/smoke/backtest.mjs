import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const base = process.env.BACKTEST_BASE_URL ?? "http://127.0.0.1:3000",
  browser = await chromium.launch();
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/backtest?*", (route) =>
      route.fulfill({
        json: {
          coverage: [
            {
              owner: "sample",
              events: 2,
              complete: false,
              stopReason: "Synthetic incomplete sample",
            },
          ],
          from: 1,
          to: 2,
          cut: 2,
          warning: "Synthetic browser test only.",
          results: [
            {
              strategy: "Small entries",
              cash: "105000000",
              realizedPnl: "5000000",
              openCost: "0",
              openPositions: 0,
              modeledFees: "10000",
              realizedDrawdown: "0",
              copied: 1,
              skipped: 0,
              closed: 1,
              training: "0",
              holdout: "5000000",
              receipts: [],
            },
          ],
        },
      }),
    );
    await page.goto(base + "/backtest");
    await page
      .getByRole("button", { name: "Compare three strategies" })
      .click();
    await page.getByRole("heading", { name: "Strategy comparison" }).waitFor();
    await page
      .getByText("Incomplete: Synthetic incomplete sample", { exact: false })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: "docs/screenshots/backtest-" + viewport.width + ".png",
      fullPage: true,
    });
    await context.close();
    console.log("Backtest browser checks passed: " + viewport.width + "px.");
  }
  if (process.env.SMOKE_LIVE_READS === "true") {
    const params = new URLSearchParams({
      budget: "100000000",
      fee: "100",
      slippage: "100",
    });
    [
      "E1Uc6BvyLS1cP47yuYq4sGQqbQPrrH6YKVuth88NzeHm",
      "782PjCvahP97LUL5KQ1rxzXWWExrcvMnemFxgn9LrfED",
      "DVHD66wYT5wFcgJ9K2SbtJTmbsJxzz6chkAzNwzbksdT",
    ].forEach((owner) => params.append("owner", owner));
    const r = await fetch(base + "/api/backtest?" + params, {
        signal: AbortSignal.timeout(180000),
      }),
      j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j.error));
    assert.equal(j.results.length, 3);
    writeFileSync(
      "docs/research/backtest-results.json",
      JSON.stringify({ retrievedAt: new Date().toISOString(), ...j }, null, 2),
    );
    console.log(
      "Live history replay passed: " +
        j.coverage
          .map(
            (x) =>
              x.events +
              " events (" +
              (x.complete ? "complete" : "incomplete") +
              ")",
          )
          .join(", "),
    );
  }
} finally {
  await browser.close();
}
