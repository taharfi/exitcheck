import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deepSeekResearch } from "@/features/trade/deepseek";
import { researchMarket } from "@/features/trade/research";
import { researchSchema, type MarketItem } from "@/features/trade/types";
const market: MarketItem = {
  id: "poly:deepseek-test",
  providerId: "test",
  question: "Will the event occur?",
  category: "Other",
  source: "polymarket",
  dataProvider: "gamma",
  yesPrice: 0.6,
  noPrice: 0.4,
  volume24h: null,
  liquidity: null,
  resolutionDate: new Date(Date.now() + 86400000).toISOString(),
  rules: "YES when the stated event occurs.",
  oracleSource: "Market rules",
  url: "https://polymarket.com/event/test",
  tokenIds: [],
  capturedAt: Date.now(),
  tradable: true,
};
const analysis = {
  bullThesis: ["YES requires the stated event."],
  bearThesis: ["The event may not occur."],
  whyThisCouldBeWrong: "The supplied rules may be incomplete.",
  nextCheck: "Verify the event with the named resolution source.",
};
const response = (content: unknown, finish = "stop") =>
  Response.json({
    choices: [
      { finish_reason: finish, message: { content: JSON.stringify(content) } },
    ],
  });
beforeEach(() => {
  vi.stubEnv("RESEARCH_PROVIDER", "deepseek");
  vi.stubEnv("DEEPSEEK_MODEL", "deepseek-flash");
  vi.stubEnv("DEEPSEEK_API_KEY", "test-only-deepseek-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("DeepSeek rules analysis", () => {
  it("runs three JSON perspectives but never invents citations or recommends a trade", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response(analysis));
    const report = researchSchema.parse(
      await researchMarket(market, transport),
    );
    expect(report.mode).toBe("deepseek");
    expect(report.citations).toEqual([]);
    expect(report.proposedTrade).toEqual({
      action: "PASS",
      limitPrice: 0.6,
      kellyExposureUSD: 0,
    });
    expect(report.confidence).toBe(0);
    expect(report.nextCheck).toBe(analysis.nextCheck);
    expect(transport).toHaveBeenCalledTimes(3);
    for (const [url, options] of transport.mock.calls) {
      expect(url).toBe("https://api.deepseek.com/chat/completions");
      expect(new Headers(options?.headers).get("Authorization")).toBe(
        "Bearer test-only-deepseek-key",
      );
      const body = JSON.parse(String(options?.body));
      expect(body.model).toBe("deepseek-flash");
      expect(body.response_format).toEqual({ type: "json_object" });
      expect(body.tools).toBeUndefined();
    }
  });
  it("accepts one-item risk/check bullets while retaining strict validation", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () =>
      response({
        ...analysis,
        whyThisCouldBeWrong: [analysis.whyThisCouldBeWrong],
        nextCheck: [analysis.nextCheck],
      }),
    );
    const report = await researchMarket(market, transport);
    expect(report.mode).toBe("deepseek");
    expect(report.whyThisCouldBeWrong).toBe(analysis.whyThisCouldBeWrong);
    expect(report.nextCheck).toBe(analysis.nextCheck);
  });
  it("accepts single thesis text without weakening its bounds or allowing a trade", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        response({
          ...analysis,
          bullThesis: analysis.bullThesis[0],
          bearThesis: analysis.bearThesis[0],
        }),
      );
    const report = await researchMarket(market, transport);
    expect(report.mode).toBe("deepseek");
    expect(report.bullThesis).toEqual(analysis.bullThesis);
    expect(report.proposedTrade.action).toBe("PASS");
    const tooLong = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        response({ ...analysis, bullThesis: "x".repeat(1501) }),
      );
    expect((await researchMarket(market, tooLong)).mode).toBe("heuristic");
  });
  it("blocks incomplete responses instead of returning partial analysis", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response(analysis, "length"));
    const result = await researchMarket(market, transport);
    expect(result.mode).toBe("heuristic");
    expect(result.notice).toMatch(/incomplete/);
    expect(result.proposedTrade.action).toBe("PASS");
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("rejects invented extra citation fields", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () =>
      response({
        ...analysis,
        citations: [{ url: "https://example.com/fake" }],
      }),
    );
    const result = await researchMarket(market, transport);
    expect(result.mode).toBe("heuristic");
    expect(result.citations).toEqual([]);
  });
  it("shows insufficient balance and never falls back to another paid provider", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(null, { status: 402 }));
    const result = await researchMarket(market, transport);
    expect(result.notice).toMatch(/balance is insufficient/);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("does not make requests without the DeepSeek key", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    const transport = vi.fn<typeof fetch>();
    const result = await researchMarket(market, transport);
    expect(result.notice).toMatch(/DeepSeek is not configured/);
    expect(transport).not.toHaveBeenCalled();
    await expect(deepSeekResearch(market, transport)).rejects.toThrow(
      /not configured/,
    );
  });
});
