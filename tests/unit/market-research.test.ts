import { afterEach, expect, it, vi } from "vitest";
import { openSqlite } from "../../src/lib/server/sqlite";
import { parseProviderJson } from "../../src/lib/provider/jupiter";
import {
  parseKalshi,
  parsePolymarket,
  verifyUnderlying,
  type FeedMarket,
} from "../../src/features/prediction-bot/market-feeds";
import {
  MarketRecorder,
  collectMarkets,
  type MarketPoint,
} from "../../src/features/prediction-bot/market-recorder";
import { compareStrategies } from "../../src/features/prediction-bot/strategy-lab";
const now = 1800000000000;
const route: FeedMarket = {
  source: "jupiter",
  id: "POLY-1-0",
  title: "Example",
  rules: "Same settlement rules",
  closesAt: now + 86400000,
  bid: "400000",
  ask: "420000",
  tokenIds: ["101", "102"],
  outcomes: ["Yes", "No"],
  outcome: "Yes",
  status: "open",
};
const external: FeedMarket = { ...route, source: "polymarket", id: "1" };
const point = (at = now, bid = "400000"): MarketPoint => ({
  at,
  routeAt: at,
  externalAt: at,
  route: { ...route, bid },
  external,
  verified: true,
  independent: false,
  reason: "Same underlying venue",
});
afterEach(() => vi.useRealTimers());
it("rejects future-dated, missing and stale retrieval times", () => {
  for (const changes of [
    { routeAt: now + 1 },
    { externalAt: now + 1 },
    { routeAt: undefined },
    { externalAt: null },
    { externalAt: now - 21000 },
  ])
    expect(
      compareStrategies([{ ...point(), ...changes }])[1].observations,
    ).toBe(0);
});
it("does not compare momentum across a changed definition or outcome", () => {
  for (const changes of [
    { rules: "New rules" },
    { outcome: "No" },
    { tokenIds: ["201", "202"] },
  ]) {
    const higher = {
      ...point(now + 60000, "450000"),
      route: { ...route, ...changes, bid: "450000", ask: "470000" },
    };
    expect(compareStrategies([point(), higher])[1].signals).toBe(0);
  }
});
it("preserves fractional Kalshi prices as exact micro dollars", () => {
  const parsed = parseKalshi(
    parseProviderJson(
      '{"markets":[{"ticker":"KX1","title":"Test","close_time":"2027-01-01T00:00:00Z","status":"active","yes_bid_dollars":"0.1234","yes_ask_dollars":"0.1250"}]}',
    ),
  );
  expect(parsed[0].bid).toBe("123400");
  expect(parsed[0].ask).toBe("125000");
});
it("never treats missing or terminal Polymarket quotes as buyable prices", () => {
  const parsed = parsePolymarket([
    {
      id: "1",
      question: "Test",
      outcomes: '["Yes","No"]',
      active: true,
      closed: false,
      bestBid: "0",
      bestAsk: "1",
    },
  ]);
  expect(parsed[0].bid).toBeNull();
  expect(parsed[0].ask).toBeNull();
});
it("requires exact tokens, outcome orientation and rules, without calling the underlying independent", () => {
  expect(verifyUnderlying(route, external)).toMatchObject({
    verified: true,
    independent: false,
  });
  for (const changed of [
    { tokenIds: ["102", "101"] },
    { rules: "Different resolution" },
    { outcomes: ["No", "Yes"] },
  ])
    expect(verifyUnderlying(route, { ...external, ...changed }).verified).toBe(
      false,
    );
  expect(
    verifyUnderlying({ ...route, outcome: "Unknown" }, external).verified,
  ).toBe(false);
});
it("uses chronological observations and blocks momentum across recording gaps", () => {
  const momentum = compareStrategies([
    point(now + 60000, "440000"),
    point(),
  ])[1];
  // Crossed quote is rejected rather than turned into a signal.
  expect(momentum.signals).toBe(0);
  const higher = {
    ...point(now + 60000, "440000"),
    route: { ...route, bid: "440000", ask: "460000" },
  };
  expect(compareStrategies([higher, point()])[1].signals).toBe(1);
  expect(
    compareStrategies([point(), { ...higher, at: now + 120000 }])[1].signals,
  ).toBe(0);
  expect(compareStrategies([higher, point()])[1]).toMatchObject({
    blocked: 1,
    qualified: false,
  });
});
it("cannot generate independent divergence from the same underlying venue", () => {
  const p = { ...point(), external: { ...external, bid: "900000" } };
  expect(compareStrategies([p])[2].signals).toBe(0);
  expect(compareStrategies([p])[0]).toMatchObject({
    signals: 0,
    qualified: false,
  });
});
it("persists observations and coordinates collector leases without reusing a missing reference", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const db = openSqlite(":memory:"),
    store = new MarketRecorder(db);
  const token = (await store.acquire(now))!;
  expect(await store.acquire(now)).toBeNull();
  await store.release("wrong-token");
  expect(await store.acquire(now)).toBeNull();
  await store.release(token);
  const loader = vi.fn(async (source: FeedMarket["source"]) => ({
    source,
    at: now,
    markets: source === "jupiter" ? [route] : [],
    error: null,
  }));
  await collectMarkets(store, loader, async () => external);
  await collectMarkets(
    store,
    loader,
    async () => {
      throw Error("Unavailable");
    },
    async () => route,
  );
  const reopened = new MarketRecorder(db);
  expect(await reopened.points()).toHaveLength(2);
  expect((await reopened.points())[0].verified).toBe(true);
  expect((await reopened.points())[1]).toMatchObject({
    verified: false,
    external: null,
  });
  expect(await reopened.feeds()).toHaveLength(3);
  db.close();
});
