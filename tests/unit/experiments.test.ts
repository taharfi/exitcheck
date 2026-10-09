import { expect, it } from "vitest";
import {
  advanceExperiment,
  createExperiment,
  parseRequest,
} from "@/features/experiments/engine";
import type { MarketItem } from "@/features/trade/types";
const now = Date.now();
const market: MarketItem = {
  id: "poly:test",
  providerId: "test",
  question: "Test?",
  category: "Other",
  source: "polymarket",
  dataProvider: "gamma",
  yesPrice: 0.5,
  noPrice: 0.5,
  volume24h: 100,
  liquidity: 20000,
  resolutionDate: new Date(now + 40 * 86400000).toISOString(),
  rules: "Rules",
  oracleSource: "UMA",
  url: "https://polymarket.com",
  capturedAt: now,
  tokenIds: [],
  tradable: true,
};
it("parses supported budgets and conserves cents across allocations", () => {
  expect(parseRequest("Test $300 across 3 strategies for 7 days")).toEqual({
    budget: 300,
    days: 7,
  });
  const exp = createExperiment("id", { budget: 100, days: 7 }, now);
  expect(exp.strategies.reduce((n, s) => n + s.cash, 0)).toBe(100);
  expect(() => parseRequest("Buy live with $300")).toThrow();
  expect(() => parseRequest("$300 in 5 strategies")).toThrow();
});
it("records forward entries with slippage, waits without evidence and throttles repeat checks", () => {
  const exp = createExperiment("id", { budget: 300, days: 7 }, now);
  const next = advanceExperiment(exp, [market], now);
  expect(next.strategies[0].cash).toBe(80);
  expect(next.strategies[0].positions[0].shares).toBeCloseTo(
    20 / (0.5 * 1.0005),
  );
  expect(next.strategies[1].cash).toBe(100);
  expect(next.strategies[1].positions).toHaveLength(0);
  expect(next.strategies[2].positions).toHaveLength(1);
  expect(advanceExperiment(next, [market], now + 100)).toEqual(next);
  expect(exp.strategies[0].positions).toHaveLength(0);
});
it("blocks stale quotes and low liquidity and never invents settlement", () => {
  const exp = createExperiment("id", { budget: 300, days: 7 }, now);
  expect(
    advanceExperiment(exp, [{ ...market, capturedAt: now - 60001 }], now)
      .strategies[0].positions,
  ).toHaveLength(0);
  const next = advanceExperiment(exp, [{ ...market, liquidity: 100 }], now);
  expect(next.strategies[2].positions).toHaveLength(0);
  const ended = advanceExperiment(next, [], exp.endsAt);
  expect(ended.complete).toBe(true);
  expect(ended.strategies[0].positions[0].stale).toBe(true);
  expect(ended.strategies[0].cash).toBe(80);
  expect(
    advanceExperiment({ ...next, paused: true }, [market], now + 60001).paused,
  ).toBe(true);
});
