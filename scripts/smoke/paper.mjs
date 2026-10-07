import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const base = process.env.PAPER_BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch();
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const traders = ["a", "b", "c"].map((ownerPubkey) => ({
      ownerPubkey,
      realizedPnlUsd: "10000000",
      totalVolumeUsd: "100000000",
      predictionsCount: "20",
      correctPredictions: "12",
      wrongPredictions: "8",
      winRatePct: "60.00",
    }));
    await page.route("**/api/paper?*", (route) =>
      route.fulfill({
        json: {
          traders,
          trades: [],
          quotes: [],
          quoteErrors: [],
          retrievedAt: Date.now(),
          coverage: "Synthetic browser test only.",
        },
      }),
    );
    await page.goto(base + "/paper");
    await page.getByRole("button", { name: /a.*realized this week/ }).click();
    await page.getByRole("button", { name: /b.*realized this week/ }).click();
    await page.getByRole("button", { name: /c.*realized this week/ }).click();
    await page.getByRole("button", { name: /Start paper portfolio/ }).click();
    await page.getByText("Available virtual cash").waitFor();
    assert.equal(await page.getByText("$100.00", { exact: true }).count(), 1);
    await page.getByRole("button", { name: "Pause new entries" }).click();
    await page.reload();
    await page.getByRole("button", { name: "Resume observation" }).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: "docs/screenshots/paper-" + viewport.width + ".png",
      fullPage: true,
    });
    await context.close();
    console.log(
      "Paper browser checks passed: " +
        viewport.width +
        "px, selection, start, pause, reload, overflow.",
    );
  }
  if (process.env.SMOKE_LIVE_READS === "true") {
    const r = await fetch(base + "/api/paper");
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j.error));
    assert.equal(j.mode, "live-read-only");
    assert.ok(j.traders.length > 0);
    console.log(
      "Live read-only feed verified: " +
        j.traders.length +
        " traders, " +
        j.trades.length +
        " recent trades.",
    );
  }
} finally {
  await browser.close();
}
