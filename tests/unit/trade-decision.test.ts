import { describe, expect, it } from "vitest";
import { tradeDecision } from "@/features/trade/decision";
import type { MarketItem, ResearchResult } from "@/features/trade/types";
const now = Date.now();
const market: MarketItem = {
  id: "poly:decision",
  providerId: "decision",
  question: "Will it happen?",
  category: "Other",
  source: "polymarket",
  dataProvider: "gamma",
  yesPrice: 0.6,
  noPrice: 0.4,
  volume24h: null,
  liquidity: null,
  resolutionDate: new Date(now + 86400000).toISOString(),
  rules: "Market rules",
  oracleSource: "Market rules",
  url: "https://polymarket.com",
  capturedAt: now,
  tokenIds: [],
  tradable: true,
};
const report: ResearchResult = {
  marketId: market.id,
  mode: "gemini",
  fairProbability: 0.75,
  marketProbability: 0.6,
  edge: 0.15,
  confidence: 0.7,
  bullThesis: ["Bull"],
  bearThesis: ["Bear"],
  whyThisCouldBeWrong: "Wrong",
  citations: [1, 2].map((i) => ({
    title: "Source",
    source: "Primary",
    url: `https://example.com/${i}`,
    summary: "Claim",
    reliability: 0.7,
  })),
  proposedTrade: { action: "BUY_YES", limitPrice: 0.6, kellyExposureUSD: 100 },
  capturedAt: now,
  agents: [],
  searchSuggestions: [],
  notice: "Model estimate",
};
describe("concise trading verdict", () => {
  it("never turns rules-only analysis into a directional trade", () => {
    expect(
      tradeDecision({ ...report, mode: "deepseek" }, market, now).action,
    ).toBe("WAIT");
  });
  it("considers paper YES only with fresh evidence and sufficient estimated edge", () => {
    expect(tradeDecision(report, market, now).action).toBe("YES");
  });
  it("uses the actual NO quote, not an invented complement", () => {
    const noReport: ResearchResult = {
      ...report,
      fairProbability: 0.2,
      edge: -0.4,
      proposedTrade: { ...report.proposedTrade, action: "BUY_NO" },
    };
    expect(tradeDecision(noReport, market, now).action).toBe("NO");
    expect(
      tradeDecision(noReport, { ...market, noPrice: 0.79 }, now).action,
    ).toBe("WAIT");
  });
  it("waits for stale quotes, changed prices and missing evidence", () => {
    expect(
      tradeDecision(report, { ...market, capturedAt: now - 61000 }, now).action,
    ).toBe("WAIT");
    expect(
      tradeDecision({ ...report, marketProbability: 0.59 }, market, now).action,
    ).toBe("WAIT");
    expect(
      tradeDecision({ ...report, citations: [] }, market, now).action,
    ).toBe("WAIT");
  });
});
