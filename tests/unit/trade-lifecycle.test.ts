import { describe, expect, it, vi } from "vitest";
import {
  emptyPaperAccount,
  executePaperOrder,
  closePaperPosition,
  paperAccountSchema,
  realizePaperPosition,
} from "@/features/trade/paper";
import { calculateExit } from "@/features/exits/calculations";
import { collectEvidence } from "@/features/trade/evidence";
import { normalizeGamma } from "@/features/trade/markets";
import type { MarketItem } from "@/features/trade/types";
const now = Date.now();
const market: MarketItem = {
  id: "poly:1",
  providerId: "1",
  question: "Will Bitcoin reach $200,000?",
  category: "Crypto",
  source: "polymarket",
  dataProvider: "gamma",
  yesPrice: 0.6,
  noPrice: 0.4,
  volume24h: null,
  liquidity: null,
  resolutionDate: new Date(now + 86400000).toISOString(),
  rules: "YES if the stated reference reaches the target.",
  oracleSource: "Contract rules",
  url: "https://polymarket.com/event/test",
  tokenIds: ["1", "2"],
  capturedAt: now,
  tradable: true,
  eventKey: "event:1",
};
const buy = () =>
  executePaperOrder(
    emptyPaperAccount(),
    market,
    "YES",
    "10",
    "0.7",
    true,
    "entry",
    now,
  );
const exit = (fillable = "4000000", at = now) =>
  calculateExit({
    quantity: "10000000",
    held: "10000000",
    isYes: true,
    depth: {
      yes: [{ price: "590000", quantity: fillable }],
      no: [],
      capturedAt: at,
    },
    referencePrice: null,
    now: at,
  });
describe("paper journal lifecycle", () => {
  it("preserves old saved accounts without a journal or receipt", () => {
    const a = buy();
    const legacy = {
      version: 1,
      revision: a.revision,
      cash: a.cash,
      killed: false,
      positions: a.positions.map(({ receipt, ...p }) => {
        expect(receipt).toBeDefined();
        return p;
      }),
    };
    expect(paperAccountSchema.parse(legacy).journal).toEqual([]);
    expect(paperAccountSchema.parse(legacy).positions[0].shares).toBe(
      "10000000",
    );
  });
  it("records partial bid-depth fills and conserves cash and remaining cost basis", () => {
    const a = closePaperPosition(buy(), "entry", exit(), true, "exit", now);
    expect(a.positions[0].shares).toBe("6000000");
    expect(a.positions[0].cost).toBe("3601800");
    expect(a.journal[0].costBasis).toBe("2401200");
    expect(a.journal[0].proceeds).toBe("2360000");
    expect(a.cash).toBe("9996357000");
    expect(paperAccountSchema.safeParse(a).success).toBe(true);
    expect(a.journal[0].receipt?.market.rules).toBe(market.rules);
  });
  it("rejects missing approval, zero bids, stale estimates, duplicate actions and modified balances", () => {
    const a = buy();
    expect(() =>
      closePaperPosition(a, "entry", exit(), false, "x", now),
    ).toThrow(/Approve/);
    expect(() =>
      closePaperPosition(a, "entry", exit("0"), true, "x", now),
    ).toThrow(/depth/);
    expect(() =>
      closePaperPosition(a, "entry", exit(), true, "x", now + 20001),
    ).toThrow(/expired/);
    const closed = closePaperPosition(a, "entry", exit(), true, "x", now);
    expect(() =>
      realizePaperPosition(
        closed,
        "entry",
        { id: "x", shares: "1", proceeds: "0", kind: "close", source: "test" },
        true,
        now,
      ),
    ).toThrow(/already/);
    expect(
      paperAccountSchema.safeParse({ ...closed, cash: a.cash }).success,
    ).toBe(false);
  });
  it("settles complete winning and losing positions with exact conservation", () => {
    for (const proceeds of ["0", "10000000"]) {
      const a = realizePaperPosition(
        buy(),
        "entry",
        {
          id: "settlement",
          shares: "10000000",
          proceeds,
          kind: "settle",
          source: "verified test result",
        },
        true,
        now,
      );
      expect(a.positions).toEqual([]);
      expect(a.journal).toHaveLength(1);
      expect(paperAccountSchema.safeParse(a).success).toBe(true);
    }
  });
  it("captures and applies the chosen fee model without changing old receipts", () => {
    const a = executePaperOrder(
      { ...emptyPaperAccount(), feeBps: 100 },
      market,
      "YES",
      "10",
      "0.7",
      true,
      "entry",
      now,
    );
    expect(a.positions[0].cost).toBe("6063030");
    expect(a.positions[0].receipt?.feeBps).toBe(100);
    const closed = closePaperPosition(
      { ...a, feeBps: 0 },
      "entry",
      exit("10000000"),
      true,
      "close",
      now,
    );
    expect(closed.journal[0].proceeds).toBe("5841000");
    expect(paperAccountSchema.safeParse(closed).success).toBe(true);
  });
  it("caps recognized shared-event exposure across different contracts", () => {
    const a = executePaperOrder(
      emptyPaperAccount(),
      market,
      "YES",
      "300",
      "0.7",
      true,
      "a",
      now,
    );
    expect(() =>
      executePaperOrder(
        a,
        { ...market, id: "poly:2" },
        "YES",
        "250",
        "0.7",
        true,
        "b",
        now,
      ),
    ).toThrow(/Related-event/);
    expect(() =>
      executePaperOrder(
        a,
        { ...market, id: "poly:2", eventKey: "other" },
        "YES",
        "250",
        "0.7",
        true,
        "b",
        now,
      ),
    ).not.toThrow();
  });
  it("retains canonical event identity from Gamma rather than guessing correlations", () => {
    const [m] = normalizeGamma(
      [
        {
          id: "1",
          question: "Question",
          slug: "test",
          active: true,
          closed: false,
          endDate: market.resolutionDate,
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.6","0.4"]',
          events: [{ id: "event-123" }],
        },
      ],
      now,
    );
    expect(m.eventKey).toBe("poly-event:event-123");
  });
});
describe("bounded primary evidence", () => {
  it("only retrieves a fixed public asset endpoint and does not trust a market's arbitrary source URL", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({
          data: { amount: "90000.00", currency: "USD", base: "BTC" },
        }),
      );
    const items = await collectEvidence(
      { ...market, url: "https://127.0.0.1/private" },
      fetcher,
    );
    expect(items).toHaveLength(1);
    expect(items[0].capturedAt).toBeGreaterThan(0);
    expect(items[0].summary).toMatch(/does not establish/);
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.coinbase.com/v2/prices/BTC-USD/spot",
    );
    expect(fetcher.mock.calls[0][1]?.redirect).toBe("error");
  });
  it("does not fabricate context when a provider fails or topic is unsupported", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(Error("Unavailable"));
    expect(await collectEvidence(market, fetcher)).toEqual([]);
    fetcher.mockClear();
    expect(
      await collectEvidence(
        { ...market, question: "Will a team win?", category: "Sports" },
        fetcher,
      ),
    ).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects external RSS links, future and stale releases", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          `<rss><channel><item><title>OpenAI release</title><link>https://attacker.test/fake</link><pubDate>${new Date().toUTCString()}</pubDate></item><item><title>OpenAI old release</title><link>https://openai.com/news/old</link><pubDate>Mon, 01 Jan 2001 00:00:00 GMT</pubDate></item><item><title>OpenAI current release</title><link>https://openai.com/news/current</link><pubDate>${new Date().toUTCString()}</pubDate><description>Official context</description></item></channel></rss>`,
        ),
      );
    const items = await collectEvidence(
      { ...market, question: "Will OpenAI release a model?", category: "Tech" },
      fetcher,
    );
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe("https://openai.com/news/current");
  });
});
