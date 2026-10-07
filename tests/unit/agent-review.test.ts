import { expect, it } from "vitest";
import {
  evaluateAgentEntry,
  inspectAgentEntry,
} from "../../src/features/copy-trading/agent-review";
import type { AgentDecision } from "../../src/features/copy-trading/agent-model";
const now = 1700000000000;
export const decision: AgentDecision = {
  id: "proposal",
  planId: "plan",
  sourceId: "1",
  sourceSignature: null,
  sourceAt: now - 20000,
  observedAt: now - 10000,
  expiresAt: now + 100000,
  marketId: "market",
  eventId: "event",
  title: "Synthetic event",
  side: "yes",
  action: "buy",
  leaderPrice: "500000",
  leaderContracts: "10000000",
  quotePrice: "500000",
  quoteAt: now - 10000,
  allocation: "10000000",
  status: "review",
  reason: "Synthetic proposal",
};
const market = {
  marketId: "market",
  eventId: "event",
  title: "Synthetic event",
  provider: "polymarket",
  status: "open",
  result: null,
  closeTime: now / 1000 + 3600,
  pricing: { buyYesPriceUsd: "500000", buyNoPriceUsd: "500000" },
  at: now,
};
const depth = {
  yes: [
    { price: "400000", quantity: "15000000" },
    { price: "490000", quantity: "5000000" },
  ],
  no: [{ price: "100000", quantity: "100000000" }],
  capturedAt: now,
};
const exchange = { active: true, at: now };
it("compares exact prices and walks same-side bids for hypothetical size without inventing net proceeds", () => {
  const r = evaluateAgentEntry(decision, market, depth, exchange, now);
  expect(r.entry.status).toBe("within_limit");
  expect(r.entry.hypotheticalContracts).toBe("20000000");
  expect(r.sourceDelayMs).toBe(10000);
  expect(r.exit.estimate?.gross).toBe("8450000");
  expect(r.exit.estimate?.net).toBeNull();
  expect(r.exit.coverageBps).toBe("10000");
  expect(r.execution).toBe("disabled");
  expect(r.expiresAt).toBe(now + 20000);
});
it("uses NO bids for NO positions and reports uncovered size rather than full-size proceeds", () => {
  const r = evaluateAgentEntry(
    { ...decision, side: "no" },
    market,
    { ...depth, no: [{ price: "200000", quantity: "2000000" }] },
    exchange,
    now,
  );
  expect(r.exit.status).toBe("limited");
  expect(r.exit.coverageBps).toBe("1000");
  expect(r.exit.estimate?.gross).toBe("400000");
  expect(r.exit.estimate?.remaining).toBe("18000000");
});
it("does not equate missing or stale depth with a verified zero-liquidity book", () => {
  for (const book of [
    null,
    { ...depth, capturedAt: now - 20001 },
    { ...depth, capturedAt: now + 1 },
  ]) {
    const r = evaluateAgentEntry(decision, market, book, exchange, now);
    expect(r.exit.status).toBe("unknown");
    expect(r.exit.estimate).toBeNull();
  }
  const empty = evaluateAgentEntry(
    decision,
    market,
    { yes: [{ price: "0", quantity: "100000000" }], no: [], capturedAt: now },
    exchange,
    now,
  );
  expect(empty.exit.status).toBe("limited");
  expect(empty.exit.coverageBps).toBe("0");
});
it("blocks moved prices, closed markets and inactive exchange without presenting execution authorization", () => {
  const changed = evaluateAgentEntry(
    decision,
    { ...market, pricing: { ...market.pricing, buyYesPriceUsd: "515001" } },
    depth,
    exchange,
    now,
  );
  expect(changed.entry.status).toBe("blocked");
  expect(
    evaluateAgentEntry(
      decision,
      market,
      depth,
      { ...exchange, active: false },
      now,
    ).entry.status,
  ).toBe("blocked");
  expect(
    evaluateAgentEntry(
      decision,
      { ...market, closeTime: now / 1000 },
      depth,
      exchange,
      now,
    ).entry.status,
  ).toBe("blocked");
  expect(
    evaluateAgentEntry(decision, market, depth, null, now).entry.status,
  ).toBe("unknown");
  expect(
    evaluateAgentEntry(
      decision,
      { ...market, at: now - 20001 },
      depth,
      exchange,
      now,
    ).entry.quotePrice,
  ).toBeNull();
});
it("rejects foreign market identity and does not inspect expired or dismissed proposals", () => {
  expect(() =>
    evaluateAgentEntry(
      decision,
      { ...market, eventId: "foreign" },
      depth,
      exchange,
      now,
    ),
  ).toThrow(/does not match/);
  for (const d of [
    { ...decision, expiresAt: now },
    { ...decision, status: "dismissed" as const },
  ]) {
    const r = evaluateAgentEntry(d, market, depth, exchange, now);
    expect(r.entry.status).toBe("blocked");
    expect(r.exit.estimate).toBeNull();
  }
});
it("keeps independent provider failures visible and reads only market, book and trading status", async () => {
  const paths: string[] = [];
  const r = await inspectAgentEntry(
    decision,
    async (path) => {
      paths.push(path);
      if (path.startsWith("/markets/")) return market;
      if (path.startsWith("/orderbook/")) throw Error("unavailable");
      return { trading_active: true };
    },
    () => now,
  );
  expect(paths.sort()).toEqual([
    "/markets/market",
    "/orderbook/market",
    "/trading-status",
  ]);
  expect(r.entry.status).toBe("within_limit");
  expect(r.exit.status).toBe("unknown");
});
