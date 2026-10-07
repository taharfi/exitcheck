import { chromium, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
const base = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const wallet = "11111111111111111111111111111111",
  trader = "DVHD66wYT5wFcgJ9K2SbtJTmbsJxzz6chkAzNwzbksdT";
const browser = await chromium.launch();
try {
  mkdirSync("docs/screenshots", { recursive: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    let plan = null,
      decisions = [],
      journal = [],
      monitoring = null,
      signedIn = true,
      posts = 0,
      reviewPosts = 0;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/auth", async (route) => {
      if (route.request().method() === "POST") signedIn = false;
      await route.fulfill({
        json: {
          user: signedIn ? { wallet, expiresAt: Date.now() + 86400000 } : null,
        },
      });
    });
    let activityReads = 0;
    await page.route("**/api/agent/trader?*", async (route) => {
      activityReads++;
      const selected = new URL(route.request().url()).searchParams.get(
        "trader",
      );
      if (activityReads === 2) {
        await route.fulfill({
          status: 503,
          json: { error: { message: "Synthetic trader-history outage." } },
        });
        return;
      }
      if (activityReads === 5) {
        await route.fulfill({
          json: {
            trader: selected,
            retrievedAt: Date.now(),
            sampledEvents: 0,
            buys: 0,
            sells: 0,
            excludedFills: 0,
            hasMoreEvents: false,
            lastFillAt: null,
            recentFills: [],
          },
        });
        return;
      }
      const now = Date.now();
      await route.fulfill({
        json: {
          trader: selected,
          retrievedAt: now,
          sampledEvents: 12,
          buys: 2,
          sells: 1,
          excludedFills: 0,
          hasMoreEvents: true,
          lastFillAt: now - 3600000,
          recentFills: [
            {
              id: "9",
              marketId: "sample-market",
              title: "Synthetic historical fill",
              action: "buy",
              side: "yes",
              at: now - 3600000,
              price: "500000",
              quantity: "20000000",
            },
          ],
        },
      });
    });
    const snapshot = () => ({
      signedIn,
      plan: signedIn ? plan : null,
      decisions: signedIn ? decisions : [],
      journal: signedIn ? journal : [],
      monitoring:
        signedIn && monitoring
          ? {
              ...monitoring,
              continuity:
                plan.status !== "watching"
                  ? "interrupted"
                  : !plan.cursor
                    ? "not_started"
                    : "overlap_observed",
            }
          : null,
      reserved: signedIn
        ? String(
            decisions
              .filter((d) => d.status === "review")
              .reduce((sum, d) => sum + BigInt(d.allocation), 0n),
          )
        : "0",
      collectorEnabled: true,
      providerConfigured: true,
      execution: "disabled",
      coverage:
        "Synthetic UI test records. Follower fees, depth and funded execution remain unverified.",
    });
    await page.route("**/api/agent/review", async (route) => {
      reviewPosts++;
      const input = route.request().postDataJSON();
      expect(input).toEqual({
        planId: plan.id,
        decisionId: decisions.find((d) => d.status === "review").id,
        depositAsset: reviewPosts === 1 ? "USDC" : "JupUSD",
      });
      if (reviewPosts === 3) {
        await route.fulfill({
          status: 503,
          json: {
            error: {
              message: "Synthetic provider outage; entry check unavailable.",
            },
          },
        });
        return;
      }
      const now = Date.now();
      const report = {
        decisionId: input.decisionId,
        checkedAt: now,
        expiresAt: reviewPosts === 2 ? now - 1 : now + 20000,
        sourceDelayMs: 5000,
        market: {
          title: "Synthetic test event",
          provider: "polymarket",
          closesAt: now + 3600000,
        },
        entry: {
          status: "within_limit",
          reason:
            "Indicative price is within the planning limit; fees and buy depth remain unverified.",
          quotePrice: "610000",
          differenceBps: "166",
          hypotheticalContracts: "16393442",
        },
        exit: {
          status: "limited",
          reason:
            "Synthetic positive bids cover only part of this hypothetical size.",
          coverageBps: "6100",
          estimate: {
            requested: "16393442",
            fillable: "10000000",
            gross: "6000000",
            fee: null,
            net: null,
            remaining: "6393442",
            averagePrice: "600000",
            referenceValue: null,
            impactBps: "0",
            impactReferencePrice: "600000",
            insufficient: true,
            capturedAt: now,
          },
        },
        execution: "disabled",
        wallet: {
          status: input.depositAsset === "USDC" ? "within_budget" : "blocked",
          reason:
            input.depositAsset === "USDC"
              ? "Synthetic balances and held cost are within planning limits before fees."
              : "The selected token cannot cover pending proposed entries before fees.",
          selectedAsset: input.depositAsset,
          funds: {
            at: now,
            balances: { USDC: "100000000", JupUSD: "0" },
            solLamports: "1000000",
          },
          exposure: {
            at: now,
            heldCost: "10000000",
            eventCost: "5000000",
            positionCount: 1,
            openOrders: 0,
            oppositeContracts: "0",
          },
          pendingAllocation: "10000000",
          remainingBudget: "60000000",
          remainingEventBudget: "5000000",
          providerFee: null,
          networkFee: null,
        },
      };
      journal.unshift({
        id: randomUUID(),
        planId: plan.id,
        decision: { ...decisions.find((d) => d.id === input.decisionId) },
        review: report,
        outcome: "not_executed",
      });
      await route.fulfill({ json: report });
    });
    await page.route("**/api/agent", async (route) => {
      if (route.request().method() === "POST") {
        posts++;
        const input = route.request().postDataJSON(),
          now = Date.now();
        if (input.action === "start") {
          expect(input.settings).toEqual({
            trader,
            budget: "100",
            entry: "10",
          });
          plan = {
            id: randomUUID(),
            wallet,
            trader,
            budget: "100000000",
            entry: "10000000",
            status: "watching",
            revision: 0,
            createdAt: now - 60000,
            acceptAfter: now - 60000,
            expiresAt: now + 7 * 86400000,
            cursor: { id: "3", fingerprint: "synthetic" },
            lastPoll: now - 20000,
            lastSuccess: now - 20000,
            polls: 2,
            pages: 1,
            gaps: 0,
            error: null,
          };
          const decision = (status, sourceId) => ({
            id: randomUUID(),
            planId: plan.id,
            sourceId,
            sourceSignature: null,
            sourceAt: now - 5000,
            observedAt: now,
            expiresAt: now + 120000,
            marketId: "synthetic-market",
            eventId: "synthetic-event",
            title: "Synthetic test event",
            side: "yes",
            action: status === "exit_signal" ? "sell" : "buy",
            leaderPrice: "600000",
            leaderContracts: "20000000",
            quotePrice: "610000",
            quoteAt: now,
            allocation: status === "review" ? "10000000" : "0",
            status,
            reason:
              status === "review"
                ? "Preliminary proposal. No order has been placed."
                : status === "exit_signal"
                  ? "Trader sell detected; no executed copy position exists."
                  : "Indicative price exceeded the planning limit.",
          });
          decisions = [
            decision("review", "1"),
            decision("skipped", "2"),
            decision("exit_signal", "3"),
          ];
          monitoring = {
            planId: plan.id,
            calculatedAt: now,
            recordingStartedAt: now - 60000,
            latestRecordedAt: now - 20000,
            polls: 2,
            olderPollsWithoutRecords: 0,
            baselines: 1,
            overlapChecks: 1,
            failedChecks: 0,
            continuityFailures: 0,
            fills: 3,
            buys: 2,
            sells: 1,
            proposed: 1,
            skipped: 1,
            exitSignals: 1,
            delay: {
              samples: 3,
              excluded: 0,
              averageMs: 5000,
              maximumMs: 5000,
            },
            drift: {
              samples: 2,
              unquotedBuys: 0,
              averageBps: "166",
              maximumBps: "166",
            },
            skipReasons: [
              {
                reason: "Indicative price exceeded the planning limit.",
                count: 1,
              },
            ],
          };
        } else if (input.action === "dismiss")
          decisions = decisions.map((d) =>
            d.id === input.decisionId ? { ...d, status: "dismissed" } : d,
          );
        else if (input.action === "refresh") {
          plan.status = "paused";
          plan.error =
            "The saved history boundary could not be found. Watching is paused.";
          monitoring.polls++;
          monitoring.failedChecks++;
          monitoring.continuityFailures++;
        } else if (input.action === "resume") {
          plan.status = "watching";
          plan.error = null;
          plan.cursor = null;
        } else if (input.action === "pause") {
          plan.status = "paused";
          decisions = decisions.map((d) =>
            d.status === "review" ? { ...d, status: "dismissed" } : d,
          );
        } else if (input.action === "stop") plan.status = "stopped";
      }
      await route.fulfill({ json: snapshot() });
    });
    await page.goto(base + "/agent?trader=" + trader + "&budget=250");
    await expect(
      page.getByLabel("Planning budget (USD)", { exact: true }),
    ).toHaveValue("250");
    await page.getByRole("button", { name: "$100", exact: true }).click();
    const nextStep = page.getByRole("region", { name: "Your next step" });
    await expect(
      nextStep.getByRole("heading", { name: "Your plan is ready to watch" }),
    ).toBeVisible();
    await page
      .getByLabel("Trader wallet", { exact: true })
      .fill("not-a-wallet");
    await expect(
      nextStep.getByRole("heading", { name: "Choose one trader" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start watching", exact: true }),
    ).toBeDisabled();
    expect(posts).toBe(0);
    await page.getByLabel("Trader wallet", { exact: true }).fill(trader);
    await expect(
      page.getByLabel("Planning budget (USD)", { exact: true }),
    ).toHaveValue("100");
    await page.getByLabel("Amount per entry (USD)", { exact: true }).fill("21");
    await expect(
      nextStep.getByRole("heading", { name: "Adjust your planning budget" }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Amount per entry (USD)", { exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByLabel("Planning budget (USD)", { exact: true }),
    ).toHaveAttribute("aria-invalid", "false");
    await expect(
      nextStep.getByRole("link", { name: "Adjust limits" }),
    ).toHaveAttribute("href", "#agent-entry");
    await expect(
      page.getByRole("button", { name: "Start watching" }),
    ).toBeDisabled();
    await page.getByLabel("Amount per entry (USD)", { exact: true }).fill("10");
    await expect(
      page.getByRole("navigation", { name: "Copy trading steps" }),
    ).toBeVisible();
    await expect(page.getByLabel("Trader wallet", { exact: true })).toHaveValue(
      trader,
    );
    const activityPreview = page.getByRole("region", {
      name: "Trader activity preview",
    });
    expect(activityReads).toBe(0);
    await activityPreview
      .getByRole("button", { name: "Check trader activity", exact: true })
      .click();
    await expect(
      activityPreview.getByText("2 / 1", { exact: true }),
    ).toBeVisible();
    await activityPreview.locator("summary").click();
    await expect(
      activityPreview.getByText("Bought YES · Synthetic historical fill", {
        exact: true,
      }),
    ).toBeVisible();
    expect(posts).toBe(0); // Previewing history must not start or modify a plan.
    await activityPreview
      .getByRole("button", { name: "Refresh trader activity", exact: true })
      .click();
    await expect(activityPreview.getByRole("alert")).toContainText(
      "Synthetic trader-history outage",
    );
    await expect(
      activityPreview.getByText("2 / 1", { exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("Trader wallet", { exact: true }).fill(wallet);
    await expect(activityPreview.getByRole("alert")).toHaveCount(0);
    await page.getByLabel("Trader wallet", { exact: true }).fill(trader);
    await activityPreview
      .getByRole("button", { name: "Check trader activity", exact: true })
      .click();
    await expect(
      activityPreview.getByText("2 / 1", { exact: true }),
    ).toBeVisible();
    expect(activityReads).toBe(3);
    await expect(
      page.getByRole("button", { name: "Start watching", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Start watching", exact: true })
      .click();
    for (const label of ["Review needed", "Skipped", "Exit detected"])
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    await expect(
      nextStep.getByRole("heading", { name: "You have proposals to review" }),
    ).toBeVisible();
    await activityPreview
      .getByRole("button", { name: "Check trader activity", exact: true })
      .click();
    await expect(
      activityPreview.getByText("2 / 1", { exact: true }),
    ).toBeVisible();
    const report = page.getByRole("region", {
      name: "Monitoring report",
      exact: true,
    });
    await expect(
      report.getByText("Limited observation evidence", { exact: true }),
    ).toBeVisible();
    await expect(
      report.locator("dl").first().getByText("+1.66%", { exact: true }),
    ).toBeVisible();
    await report.locator("summary").click();
    await expect(
      report.getByText("Indicative price exceeded the planning limit.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      report.getByText(
        "Complete trade coverage and follower execution remain unverified.",
        { exact: false },
      ),
    ).toBeVisible();
    await report.locator("summary").click();
    await expect(
      page.getByRole("button", {
        name: "Trade approval unavailable",
        exact: true,
      }),
    ).toBeDisabled();
    const check = page.getByRole("region", {
      name: "Entry price and exit check",
    });
    await check
      .getByRole("button", { name: "Check price & exit", exact: true })
      .click();
    await expect(
      check.getByText("Price within planning limit", { exact: true }),
    ).toBeVisible();
    await expect(check.getByText("61.00%", { exact: true })).toBeVisible();
    await expect(
      check.getByText("Exit liquidity covers only part of this size", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(check.getByText("$6.00", { exact: true })).toBeVisible();
    await expect(
      check.getByText(
        "Synthetic balances and held cost are within planning limits before fees.",
        { exact: true },
      ),
    ).toBeVisible();
    const saved = page.getByRole("region", { name: "Decision journal" });
    await expect(saved.locator("summary")).toHaveCount(1);
    await page.screenshot({
      path: `docs/screenshots/agent-ui-${width}.png`,
      fullPage: true,
    });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw Error(`Agent overflow at ${width}`);
    await page.reload();
    await expect(
      report.locator("dl").first().getByText("+1.66%", { exact: true }),
    ).toBeVisible();
    const capturedMonitoring = monitoring;
    monitoring = {
      ...monitoring,
      fills: 0,
      buys: 0,
      sells: 0,
      proposed: 0,
      skipped: 0,
      exitSignals: 0,
      delay: { samples: 0, excluded: 0, averageMs: null, maximumMs: null },
      drift: {
        samples: 0,
        unquotedBuys: 0,
        averageBps: null,
        maximumBps: null,
      },
      skipReasons: [],
    };
    await page.reload();
    await expect(
      report.getByText("No fills observed yet", { exact: true }),
    ).toBeVisible();
    await expect(
      report.getByText("Not measured", { exact: true }).first(),
    ).toBeVisible();
    monitoring = capturedMonitoring;
    await page.reload();
    await expect(saved.locator("summary")).toHaveCount(1);
    await saved.locator("summary").click();
    await expect(
      saved.getByText("No agent trade executed", { exact: true }),
    ).toBeVisible();
    await check.getByLabel("Planning deposit token").selectOption("JupUSD");
    await check
      .getByRole("button", { name: "Check price & exit", exact: true })
      .click();
    await expect(
      check.getByText(
        "Snapshot expired. Refresh before using these estimates.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(check.getByText("$6.00", { exact: true })).toHaveCount(0);
    await expect(
      check.getByText("Refresh this review", { exact: true }),
    ).toBeVisible();
    await check
      .getByRole("button", { name: "Refresh entry check", exact: true })
      .click();
    await expect(check.getByRole("alert")).toContainText(
      "Synthetic provider outage",
    );
    await page
      .getByRole("button", { name: "Dismiss proposal", exact: true })
      .click();
    await expect(page.getByText("Dismissed", { exact: true })).toBeVisible();
    await expect(
      report.getByText("Limited observation evidence", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Check new activity", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "history boundary" }),
    ).toBeVisible();
    await expect(
      report.getByText("Observation interrupted.", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Check new activity", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Resume watching", exact: true })
      .click();
    await expect(
      page.getByText(
        "Waiting for the first successful history check to establish a baseline.",
        { exact: true },
      ),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Pause watching", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Resume watching", exact: true }),
    ).toBeVisible();
    await expect(
      nextStep.getByRole("heading", { name: "Your plan is paused" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Stop plan", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Set up your agent", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Sign out & disconnect", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Start watching", exact: true }),
    ).toBeDisabled();
    await expect(
      nextStep.getByRole("heading", { name: "Sign in to save your plan" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Synthetic test event", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Decision journal", exact: true }),
    ).toHaveCount(0);
    await expect(report).toHaveCount(0);
    await activityPreview
      .getByRole("button", { name: "Check trader activity", exact: true })
      .click();
    await expect(
      activityPreview.getByText("None in this sample", { exact: true }),
    ).toBeVisible();
    await expect(
      activityPreview.getByText(
        "No usable filled trades appeared in the sampled records. Older activity may exist.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(activityReads).toBe(5);
    if (posts !== 6 || reviewPosts !== 3 || errors.length)
      throw Error(JSON.stringify({ posts, reviewPosts, errors }));
    await page.close();
    console.log(
      `Agent UI passed at ${width}px: public trader activity preview, wallet-change reset, outage/retry, empty sample, price/exit checks, partial bid coverage, stale/outage states, dismissal, gap pause, resume, stop and account isolation. No transactions.`,
    );
  }
  const response = await fetch(base + "/api/agent"),
    real = await response.json();
  if (
    !response.ok ||
    real.execution !== "disabled" ||
    real.plan !== null ||
    real.signedIn !== false ||
    real.monitoring !== null
  )
    throw Error("Anonymous agent API boundary failed.");
  const privateReview = await fetch(base + "/api/agent/review", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({
      planId: "11111111-1111-4111-8111-111111111111",
      decisionId: "22222222-2222-4222-8222-222222222222",
    }),
  });
  if (
    privateReview.status !== 401 ||
    (await privateReview.json()).error?.code !== "SIGN_IN_REQUIRED"
  )
    throw Error("Anonymous private review access was not rejected.");
  console.log("Real agent API privacy boundaries passed; execution disabled.");
} finally {
  await browser.close();
}
