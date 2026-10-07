import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { mkdir } from "node:fs/promises";
const origin = process.env.TEST_ORIGIN ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ headless: true });
await mkdir("docs/screenshots", { recursive: true });
for (const width of [1440, 390]) {
  const context = await browser.newContext({
      viewport: { width, height: 1000 },
    }),
    page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const at = Date.now(),
    market = {
      source: "jupiter",
      id: "POLY-1",
      title: "Synthetic UI check · Bitcoin threshold",
      rules: "Synthetic settlement rules for layout testing only.",
      closesAt: at + 86400000,
      bid: "400000",
      ask: "430000",
      tokenIds: ["101", "102"],
      outcomes: ["Yes", "No"],
      outcome: "Yes",
      status: "open",
    };
  const snapshot = {
    feeds: [
      { source: "jupiter", at, count: 1, error: null },
      {
        source: "polymarket",
        at,
        count: 1,
        error: null,
      },
      {
        source: "kalshi",
        at,
        count: 0,
        error: "Provider returned HTTP 429.",
      },
    ],
    markets: [
      {
        at,
        route: market,
        external: { ...market, source: "polymarket" },
        verified: true,
        independent: false,
        reason: "Same underlying venue; not an independent probability signal.",
      },
    ],
    observations: 6,
    firstAt: at - 60000,
    lastAt: at,
    strategies: [
      {
        strategy: "No trade",
        signals: 0,
        observations: 6,
        reason: "Keep all cash.",
        qualified: false,
      },
      {
        strategy: "Momentum",
        signals: 1,
        observations: 6,
        reason: "Entries blocked until depth and fees are verified.",
        qualified: false,
      },
      {
        strategy: "Price divergence",
        signals: 0,
        observations: 6,
        reason: "Same underlying venue is not independent.",
        qualified: false,
      },
    ],
    collectorEnabled: true,
    qualification: "No strategy has qualified on unseen data.",
    coverage: "Synthetic UI sample; not live financial evidence.",
    bot: null,
    signedIn: false,
  };
  await page.route("**/api/bot", (r) => r.fulfill({ json: snapshot }));
  await page.goto(origin + "/bot");
  await page
    .getByRole("heading", { name: "Compare rules before committing money" })
    .waitFor();
  await page.getByText("Provider returned HTTP 429.").waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Save & watch" }).isDisabled(),
    true,
  );
  await page.getByText("Outcome and settlement rules").click();
  await page.getByText(market.rules).waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: `docs/screenshots/bot-${width}.png`,
    fullPage: true,
  });
  await context.close();
  console.log(`Bot UI passed ${width}px (synthetic fixtures)`);
}
const live = await browser.newContext();
const page = await live.newPage();
await page.goto(origin + "/bot");
const response = await page.request.get(origin + "/api/bot"),
  body = await response.json();
assert.equal(response.status(), 200);
assert.equal(body.execution, "disabled");
assert.equal(body.bot, null);
// Real local challenge/verification endpoints; ephemeral synthetic signer, no transactions.
const key = nacl.sign.keyPair();
const challenge = await page.request.post(origin + "/api/auth", {
  headers: { origin },
  data: { action: "challenge", wallet: bs58.encode(key.publicKey) },
});
assert.equal(challenge.status(), 200);
const login = await challenge.json();
const verified = await page.request.post(origin + "/api/auth", {
  headers: { origin },
  data: {
    action: "verify",
    signature: bs58.encode(
      nacl.sign.detached(
        new TextEncoder().encode(login.message),
        key.secretKey,
      ),
    ),
  },
});
assert.equal(verified.status(), 200);
await page.reload();
await page.getByRole("button", { name: "Save & watch" }).waitFor();
await page.getByRole("button", { name: "Save & watch" }).isEnabled();
await page.getByLabel("Virtual budget", { exact: true }).fill("250");
await page.getByRole("button", { name: "Save & watch" }).click();
await page
  .getByText("$250 virtual cash · Momentum · Watching", { exact: true })
  .waitFor();
await page.reload();
await page
  .getByText("$250 virtual cash · Momentum · Watching", { exact: true })
  .waitFor();
await page.getByRole("button", { name: "Pause watching" }).click();
await page
  .getByText("$250 virtual cash · Momentum · Paused", { exact: true })
  .waitFor();
assert.equal(
  (await (await page.request.get(origin + "/api/bot")).json()).execution,
  "disabled",
);
await page.request.post(origin + "/api/auth", {
  headers: { origin },
  data: { action: "logout" },
});
assert.equal(
  (await (await page.request.get(origin + "/api/bot")).json()).bot,
  null,
);
console.log(
  "Bot plan save/reload/pause/logout passed with real local auth endpoints and ephemeral test wallet",
);
console.log(
  JSON.stringify({
    liveRead: true,
    feeds: body.feeds.map((f) => ({
      source: f.source,
      markets: f.count,
      error: f.error,
    })),
    observations: body.observations,
    verifiedMarkets: body.markets.filter((m) => m.verified).length,
  }),
);
await live.close();
await browser.close();
