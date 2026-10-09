import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { normalizeGamma } from "../../src/features/trade/markets";
import {
  emptyPaperAccount,
  executePaperOrder,
  paperAccountSchema,
  paperQuote,
} from "../../src/features/trade/paper";
import {
  heuristicResearch,
  proposal,
  researchMarket,
  boundedResearch,
} from "../../src/features/trade/research";
import type { MarketItem } from "../../src/features/trade/types";
beforeEach(() => {
  vi.stubEnv("RESEARCH_PROVIDER", "gemini");
  vi.stubEnv("DEEPSEEK_API_KEY", "");
  vi.stubEnv("GEMINI_MODEL", "gemini-2.5-flash");
  for (const n of [1, 2, 3]) vi.stubEnv(`GEMINI_API_KEY_${n}`, "");
});
const now = 1800000000000;
const market: MarketItem = {
  id: "poly:test",
  providerId: "test",
  question: "Will Solana reach $200?",
  category: "Crypto",
  source: "polymarket",
  dataProvider: "gamma",
  yesPrice: 0.6,
  noPrice: 0.4,
  volume24h: 10000,
  liquidity: 20000,
  resolutionDate: new Date(now + 3600000).toISOString(),
  rules: "Resolve YES if the reference price reaches $200.",
  oracleSource: "Market rules",
  url: "https://polymarket.com/event/test",
  tokenIds: ["123", "456"],
  capturedAt: now,
  tradable: true,
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("live market normalization", () => {
  const gamma = {
    id: "1",
    question: market.question,
    slug: "test",
    active: true,
    closed: false,
    endDate: market.resolutionDate,
    outcomes: '["No","Yes"]',
    outcomePrices: '["0.4","0.6"]',
    clobTokenIds: '["456","123"]',
    acceptingOrders: true,
  };
  it("maps outcome order correctly and leaves missing financial data unknown", () => {
    const [m] = normalizeGamma([gamma], now);
    expect(m.yesPrice).toBe(0.6);
    expect(m.noPrice).toBe(0.4);
    expect(m.tokenIds).toEqual(["123", "456"]);
    expect(m.liquidity).toBeNull();
    expect(m.category).toBe("Crypto");
  });
  it("excludes expired, nonbinary, malformed and out-of-range markets", () => {
    expect(
      normalizeGamma(
        [
          { ...gamma, closed: true },
          { ...gamma, endDate: new Date(now - 1).toISOString() },
          { ...gamma, outcomes: '["UP","DOWN"]' },
          { ...gamma, outcomePrices: '["2","0"]' },
          { ...gamma, outcomes: "bad-json" },
        ],
        now,
      ),
    ).toEqual([]);
  });
});
describe("paper risk controls", () => {
  it("debits exact simulated cost with slippage and saves an auditable position", () => {
    const a = executePaperOrder(
      emptyPaperAccount(),
      market,
      "YES",
      "10",
      "0.601",
      true,
      "order1",
      now,
    );
    expect(a.cash).toBe("9993997000");
    expect(a.positions[0].entryPrice).toBe("600300");
    expect(a.positions[0].shares).toBe("10000000");
    expect(a.revision).toBe(1);
  });
  it("blocks kill switch, missing approval, duplicates, stale prices and limit violations", () => {
    expect(() =>
      executePaperOrder(
        { ...emptyPaperAccount(), killed: true },
        market,
        "YES",
        "10",
        "0.7",
        true,
        "1",
        now,
      ),
    ).toThrow(/kill/i);
    expect(() =>
      executePaperOrder(
        emptyPaperAccount(),
        market,
        "YES",
        "10",
        "0.7",
        false,
        "1",
        now,
      ),
    ).toThrow(/approval/i);
    expect(() => paperQuote(market, "YES", "10", "0.6", now)).toThrow(/Limit/);
    expect(() => paperQuote(market, "YES", "10", "0.7", now + 60001)).toThrow(
      /expired/,
    );
    const filled = executePaperOrder(
      emptyPaperAccount(),
      market,
      "YES",
      "10",
      "0.7",
      true,
      "1",
      now,
    );
    expect(() =>
      executePaperOrder(filled, market, "YES", "10", "0.7", true, "1", now),
    ).toThrow(/already/);
  });
  it("enforces cumulative market exposure and validates persisted balance conservation", () => {
    const first = executePaperOrder(
      emptyPaperAccount(),
      market,
      "YES",
      "300",
      "0.7",
      true,
      "1",
      now,
    );
    expect(() =>
      executePaperOrder(first, market, "YES", "40", "0.7", true, "2", now),
    ).toThrow(/200/);
    expect(
      paperAccountSchema.safeParse({ ...first, cash: "10000000000" }).success,
    ).toBe(false);
    expect(() =>
      paperQuote({ ...market, noPrice: null }, "NO", "10", "0.5", now),
    ).toThrow(/available/);
  });
});
describe("research honesty", () => {
  it("keeps each report on one rotated key and does not retry quota failures", async () => {
    vi.stubEnv("GEMINI_API_KEY_1", "rotation-test-one");
    vi.stubEnv("GEMINI_API_KEY_2", "rotation-test-two");
    vi.stubEnv("GEMINI_API_KEY_3", "");
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(null, { status: 429 }));
    const result = await researchMarket(market, transport);
    expect(result.notice).toMatch(/quota is exhausted/);
    await researchMarket(market, transport);
    expect(transport).toHaveBeenCalledTimes(4);
    expect(String(transport.mock.calls[0][0])).toContain(
      "gemini-2.5-flash:generateContent",
    );
    expect(
      transport.mock.calls.map(([, options]) =>
        new Headers(options?.headers).get("x-goog-api-key"),
      ),
    ).toEqual([
      "rotation-test-one",
      "rotation-test-one",
      "rotation-test-two",
      "rotation-test-two",
    ]);
  });

  it("coalesces concurrent paid research for identical canonical market inputs", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-only-key");
    const citations = ["https://example.com/a", "https://example.com/b"].map(
      (url) => ({
        title: "Evidence",
        source: "Source",
        url,
        summary: "Claim",
        reliability: 0.7,
      }),
    );
    const opinion = {
      probability: 0.7,
      confidence: 0.7,
      bullThesis: ["Bull"],
      bearThesis: ["Bear"],
      whyThisCouldBeWrong: "Falsification",
      citations,
    };
    const transport = vi.fn(async () =>
      Response.json({
        candidates: [
          {
            content: { parts: [{ text: JSON.stringify(opinion) }] },
            groundingMetadata: {
              groundingChunks: citations.map((c) => ({
                web: { uri: c.url, title: c.title },
              })),
              groundingSupports: [{ groundingChunkIndices: [0, 1] }],
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", transport);
    const input = { ...market, id: "poly:coalesced-research" };
    const [first, second] = await Promise.all([
      boundedResearch(input, "coalesce-one"),
      boundedResearch(input, "coalesce-two"),
    ]);
    expect(first).toEqual(second);
    expect(first.mode).toBe("gemini");
    expect(transport).toHaveBeenCalledTimes(5);
  });
  it("keeps the no-key baseline available without consuming paid research quota", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    for (let i = 0; i < 5; i++) {
      const result = await boundedResearch(
        { ...market, id: `poly:baseline-${i}` },
        "baseline-test",
      );
      expect(result.mode).toBe("heuristic");
      expect(result.proposedTrade.action).toBe("PASS");
    }
  });
  it("uses a neutral market prior and PASS when Gemini is unavailable", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const transport = vi.fn();
    const result = await researchMarket(market, transport);
    expect(result.mode).toBe("heuristic");
    expect(result.edge).toBe(0);
    expect(result.citations).toEqual([]);
    expect(result.proposedTrade.action).toBe("PASS");
    expect(transport).not.toHaveBeenCalled();
  });
  it("requires evidence and caps quarter Kelly exposure", () => {
    expect(proposal(0.8, 0.6, 0.9, 1, 0.4).action).toBe("PASS");
    expect(proposal(0.8, 0.6, 0.9, 2, 0.4).kellyExposureUSD).toBe(200);
    expect(proposal(0.2, 0.6, 0.9, 2, null).action).toBe("PASS");
    expect(heuristicResearch(market).confidence).toBe(0.1);
  });
  it("rejects fabricated model citations absent from grounding supports", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-only-key");
    const opinion = {
      probability: 0.8,
      confidence: 0.9,
      bullThesis: ["Bull"],
      bearThesis: ["Bear"],
      whyThisCouldBeWrong: "Wrong if data changes",
      citations: [
        {
          title: "Invented",
          source: "invented",
          url: "https://example.com/fake",
          summary: "Unsupported",
          reliability: 1,
        },
      ],
    };
    const transport = vi.fn(async () =>
      Response.json({
        candidates: [
          {
            content: { parts: [{ text: JSON.stringify(opinion) }] },
            groundingMetadata: {},
          },
        ],
      }),
    );
    const result = await researchMarket(market, transport);
    expect(result.mode).toBe("heuristic");
    expect(result.citations).toEqual([]);
    expect(result.proposedTrade.action).toBe("PASS");
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("runs bull, bear and synthesis while preserving only supported sources", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-only-key");
    const citations = [
      "https://example.com/primary1",
      "https://example.com/primary2",
    ].map((url) => ({
      title: "Evidence",
      source: "Primary source",
      url,
      summary: "Source claim",
      reliability: 0.9,
    }));
    const opinion = {
      probability: 0.75,
      confidence: 0.7,
      bullThesis: ["Bull"],
      bearThesis: ["Bear"],
      whyThisCouldBeWrong: "Falsification",
      citations,
    };
    const transport = vi.fn(async () =>
      Response.json({
        candidates: [
          {
            content: { parts: [{ text: JSON.stringify(opinion) }] },
            groundingMetadata: {
              groundingChunks: citations.map((c) => ({
                web: { uri: c.url, title: c.title },
              })),
              groundingSupports: [{ groundingChunkIndices: [0, 1] }],
            },
          },
        ],
      }),
    );
    const result = await researchMarket(market, transport);
    expect(result.mode).toBe("gemini");
    expect(result.agents).toHaveLength(3);
    expect(transport).toHaveBeenCalledTimes(5);
    expect(result.citations[0].reliability).toBe(0.7);
    expect(result.proposedTrade.action).toBe("BUY_YES");
  });
});
