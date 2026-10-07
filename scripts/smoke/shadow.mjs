import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
const base = process.env.SHADOW_BASE_URL ?? "http://127.0.0.1:3000";
const owner = "E1Uc6BvyLS1cP47yuYq4sGQqbQPrrH6YKVuth88NzeHm";
const browser = await chromium.launch();
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
        viewport: { width, height: 1000 },
      }),
      page = await context.newPage(),
      errors = [],
      actions = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.url().includes("/api/actions")) actions.push(r.url());
    });
    let portfolio = null;
    await page.route("**/api/discover?*", (route) =>
      route.fulfill({
        json: {
          traders: [owner, "782PjCvahP97LUL5KQ1rxzXWWExrcvMnemFxgn9LrfED"].map(
            (ownerPubkey) => ({
              ownerPubkey,
              realizedPnlUsd: "10000000",
              predictionsCount: "30",
            }),
          ),
        },
      }),
    );
    await page.route("**/api/shadow", async (route) => {
      if (route.request().method() === "POST") {
        const input = route.request().postDataJSON();
        if (input.action === "start") {
          assert.deepEqual(input.owners, [owner]);
          assert.equal(input.budget, "200000000");
          portfolio = {
            id: "synthetic",
            createdAt: Date.now(),
            expiresAt: Date.now() + 86400000,
            lastPoll: Date.now(),
            lastSuccess: Date.now(),
            polls: 2,
            gaps: 0,
            error: null,
            paper: {
              budget: "200000000",
              cash: "200000000",
              owners: [owner],
              paused: false,
              positions: [],
              journal: [
                {
                  id: "s",
                  at: Date.now(),
                  title: "Synthetic shared event",
                  decision: "Skipped",
                  reason:
                    "This market already has a portfolio position; duplicate and opposing copies are blocked.",
                },
              ],
            },
          };
        } else if (input.action === "stop") portfolio = null;
        else portfolio.paper.paused = input.action === "pause";
        return route.fulfill({ json: { portfolio } });
      }
      return route.fulfill({
        json: {
          portfolio,
          collectorEnabled: true,
          observations: [],
          coverage: "Synthetic browser test only.",
        },
      });
    });
    await page.route("**/api/copyability?*", (route) =>
      route.fulfill({
        json: {
          owner,
          budget: "200000000",
          observedBuys: 10,
          observedSells: 3,
          uniqueBuyEvents: 4,
          medianLeaderBuy: "20000000",
          proposedEntry: "10000000",
          assessment: "Incomplete history: synthetic sample only.",
          coverage: {
            events: 20,
            complete: false,
            stopReason: "Synthetic page cap",
          },
          prospective: {
            observedBuys: 0,
            withIndicativeQuote: 0,
            withinTwoMinutes: 0,
          },
          warning: "Fees and depth remain unverified.",
        },
      }),
    );
    await page.goto(base + "/shadow?owner=" + owner + "&budget=200000000");
    await expect(page.getByLabel("Virtual budget (USD)")).toHaveValue("200");
    await expect(page.getByRole("button", { name: /Select \+/ })).toHaveCount(
      1,
    );
    await page.getByRole("button", { name: /Select \+/ }).click();
    await expect(page.getByText("$70.00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Remove 782P/ }).click();
    await page.getByRole("button", { name: "$250", exact: true }).click();
    await expect(page.getByLabel("Virtual budget (USD)")).toHaveValue("250");
    await expect(page.getByText("$75.00", { exact: true })).toBeVisible();
    await page.getByLabel("Virtual budget (USD)").fill("5");
    await expect(
      page.getByRole("button", { name: "Start virtual copy trading" }),
    ).toBeDisabled();
    await page.getByLabel("Virtual budget (USD)").fill("200");
    await expect(page.getByText("$140.00", { exact: true })).toBeVisible();
    await page.screenshot({
      path: `docs/screenshots/copy-setup-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Start virtual copy trading" })
      .click();
    await page
      .getByRole("heading", { name: "Observing sampled trades" })
      .waitFor();
    await page.getByText("Synthetic shared event", { exact: true }).waitFor();
    await expect(page.getByText("Skipped", { exact: true })).toBeVisible();
    await page
      .getByText("Trader research and copyability reports", { exact: true })
      .click();
    await page
      .getByRole("button", { name: "Build copyability report" })
      .click();
    await page
      .getByText("Median leader buy, retrieved sample", { exact: true })
      .waitFor();
    await page.getByText(/No prospective observations yet/).waitFor();
    await page
      .getByRole("button", { name: "Pause background observation" })
      .click();
    await page.getByRole("heading", { name: "Observation paused" }).waitFor();
    await page.reload();
    await page.getByRole("heading", { name: "Observation paused" }).waitFor();
    await page
      .getByRole("button", { name: "Resume background observation" })
      .click();
    await page
      .getByRole("heading", { name: "Observing sampled trades" })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: `docs/screenshots/shadow-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Stop and clear portfolio" })
      .click();
    await page.getByRole("heading", { name: "Choose your traders" }).waitFor();
    assert.deepEqual(errors, []);
    assert.deepEqual(actions, []);
    await context.close();
    console.log(
      `Shadow UI passed at ${width}px: start, decision reasons, unknown copyability evidence, pause/reload/resume, stop and no document overflow.`,
    );
  }
  if (process.env.SHADOW_UI_ONLY === "true") process.exitCode = 0;
  else {
    const context = await browser.newContext(),
      page = await context.newPage();
    await page.goto(base + "/shadow");
    const response = await context.request.post(base + "/api/shadow", {
      headers: { Origin: base },
      data: { action: "start", owners: [owner], budget: "100000000" },
    });
    assert.equal(response.status(), 200);
    const created = (await response.json()).portfolio;
    await page.close();
    await expect
      .poll(
        async () => {
          const r = await context.request.get(base + "/api/shadow");
          const j = await r.json();
          assert.equal(j.portfolio.id, created.id);
          assert.equal(j.collectorEnabled, true);
          return j.portfolio.polls;
        },
        { timeout: 75000, intervals: [5000] },
      )
      .toBeGreaterThan(0);
    const snapshot = await (
      await context.request.get(base + "/api/shadow")
    ).json();
    assert.equal(snapshot.portfolio.paper.budget, "100000000");
    console.log(
      `Live background collector verified with browser page closed: ${snapshot.portfolio.polls} successful sampled-feed poll(s). No follower fills are claimed.`,
    );
    assert.equal(
      (
        await context.request.post(base + "/api/shadow", {
          headers: { Origin: base },
          data: { action: "stop" },
        })
      ).status(),
      200,
    );
    const r = await context.request.get(
        base + "/api/copyability?owner=" + owner + "&budget=100000000",
      ),
      report = await r.json();
    assert.equal(r.status(), 200);
    assert.equal(report.owner, owner);
    assert.equal(report.proposedEntry, "5000000");
    assert.equal(report.holdingDuration, null);
    assert.equal(report.followerDepth, "Unverified");
    console.log(
      `Live copyability report verified: ${report.coverage.events} imported events, complete=${report.coverage.complete}, follower depth unverified.`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
