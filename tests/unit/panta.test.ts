import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizePanta, pantaCatalog } from "@/features/trade/panta";
import { paperQuote } from "@/features/trade/paper";

const now = Date.now();
const id = "11111111111111111111111111111111";
const row = {
  marketId: id,
  title: "Will SOL reach $200?",
  description: "Resolution rules from the provider.",
  category: "crypto",
  phase: "primary",
  status: "open",
  resolved: false,
  startTime: Math.floor(now / 1000) - 60,
  endTime: Math.floor(now / 1000) + 3600,
  resolutionTime: Math.floor(now / 1000) + 7200,
  yesPrice: null,
  noPrice: null,
};
afterEach(() => vi.unstubAllEnvs());
describe("Panta market integration", () => {
  it("keeps historical contracts visible without enabling paper orders", () => {
    for (const change of [
      { resolved: true },
      { status: "closed" },
      { phase: "cancelled" },
    ]) {
      const market = normalizePanta(
        { ...row, ...change, yesPrice: "0.5" },
        now,
      )!;
      expect(market).toMatchObject({
        tradable: false,
        yesPrice: null,
        noPrice: null,
      });
      expect(() => paperQuote(market, "YES", "10", "0.6", now)).toThrow();
    }
  });
  it("discovers active contracts beyond the first catalog page and stops repeated cursors", async () => {
    let pages = 0;
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/markets/")) {
          pages++;
          if (!url.searchParams.has("cursor"))
            return Response.json({
              items: [{ ...row, phase: "resolved", resolved: true }],
              nextCursor: "next-page",
            });
          return Response.json({ items: [row], nextCursor: "next-page" });
        }
        return Response.json({ ...row, yesPrice: "0.52", noPrice: "0.48" });
      });
    const feed = await pantaCatalog(transport, "test-secret");
    expect(feed.markets).toHaveLength(1);
    expect(pages).toBe(2);
    expect(feed.warnings.join()).toMatch(/incomplete/);
  });
  it("accepts observed ISO catalog dates and phase-based active status", () => {
    expect(
      normalizePanta(
        {
          ...row,
          status: "primary",
          startTime: new Date(row.startTime * 1000).toISOString(),
          endTime: new Date(row.endTime * 1000).toISOString(),
          resolutionTime: new Date(row.resolutionTime * 1000).toISOString(),
        },
        now,
      ),
    ).toMatchObject({ dataProvider: "panta", tradable: false });
    expect(normalizePanta({ ...row, status: "closed" }, now)).toMatchObject({
      marketStatus: "closed",
      tradable: false,
      yesPrice: null,
    });
  });
  it("does not request the provider or invent markets without a key", async () => {
    vi.stubEnv("PANTA_API_KEY", "");
    const transport = vi.fn<typeof fetch>();
    const feed = await pantaCatalog(transport);
    expect(transport).not.toHaveBeenCalled();
    expect(feed.markets).toEqual([]);
    expect(feed.warnings.join()).toMatch(/not connected/);
  });
  it("reads detail prices instead of trusting list prices and keeps volume/depth unknown", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, options) => {
        const url = new URL(String(input));
        expect(url.origin).toBe("https://live-api.panta.market");
        expect(options?.headers).toEqual({ "X-Api-Key": "test-secret" });
        expect(options?.redirect).toBe("error");
        return Response.json(
          url.pathname.endsWith(`/markets/${id}/`)
            ? { ...row, yesPrice: "0.52", noPrice: "0.48" }
            : { items: [{ ...row, yesPrice: "0.99" }], nextCursor: null },
        );
      });
    const feed = await pantaCatalog(transport, "test-secret");
    expect(feed.markets[0]).toMatchObject({
      id: `panta:${id}`,
      dataProvider: "panta",
      source: "solana",
      yesPrice: 0.52,
      noPrice: 0.48,
      tradable: true,
      liquidity: null,
      volume24h: null,
      tokenIds: [],
    });
    expect(JSON.stringify(feed)).not.toContain("test-secret");
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("preserves unpriced catalog context on failed detail reads and blocks paper fills", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ items: [{ ...row, primaryYesPrice: "0.9" }] }),
      )
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const feed = await pantaCatalog(transport, "test-secret");
    expect(feed.markets[0]).toMatchObject({
      yesPrice: null,
      noPrice: null,
      tradable: false,
      pantaDetails: { primaryYesPrice: null },
    });
    expect(() => paperQuote(feed.markets[0], "YES", "10", "0.6")).toThrow(
      /no available live price/,
    );
    expect(feed.warnings.join()).toMatch(/unavailable/);
  });
  it("rejects malformed and out-of-range rows", () => {
    for (const change of [
      { yesPrice: "1.2" },
      { marketId: "../../secrets" },
      { resolutionTime: 1e30 },
    ])
      expect(normalizePanta({ ...row, ...change }, now)).toBeNull();
  });
  it("shows scheduled markets for research without enabling premature paper fills", () => {
    const market = normalizePanta(
      { ...row, startTime: Math.floor(now / 1000) + 60, yesPrice: "0.5" },
      now,
    );
    expect(market).toMatchObject({ tradable: false, yesPrice: 0.5 });
    expect(() => paperQuote(market!, "YES", "10", "0.6", now)).toThrow(
      /no available live price/,
    );
  });
  it("includes and labels sandbox contracts and retains provider rules and a chain-reported question", () => {
    expect(
      normalizePanta({ ...row, title: "Sandbox test market" }, now),
    ).toMatchObject({ isTestContract: true });
    expect(
      normalizePanta({ ...row, title: "[TEST] BTC >= 1000 USD" }, now),
    ).toMatchObject({ isTestContract: true });
    expect(
      normalizePanta(
        {
          ...row,
          title: "",
          question: "Will SOL reach $200?",
          resolutionRule: "Official closing price",
          sources: ["https://example.com/rules"],
        },
        now,
      ),
    ).toMatchObject({
      question: "Will SOL reach $200?",
      rules: expect.stringContaining("Official closing price"),
    });
  });
  it("blocks paper orders at trading close even when resolution is later", () => {
    const market = normalizePanta(
      { ...row, yesPrice: "0.52", noPrice: "0.48" },
      now,
    )!;
    expect(() =>
      paperQuote(
        { ...market, capturedAt: now + 3_600_000 },
        "YES",
        "10",
        "0.6",
        now + 3_600_000,
      ),
    ).toThrow(/expired/);
  });
  it("bounds detail concurrency and discards mismatched market identities", async () => {
    let active = 0,
      peak = 0;
    const rows = Array.from({ length: 25 }, (_, index) => ({
      ...row,
      marketId: "1".repeat(31) + "23456789ABCDEFGHJKLMNPQRST"[index],
    }));
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/markets/"))
          return Response.json({ items: rows });
        active++;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active--;
        const marketId = url.pathname.split("/").at(-2);
        return Response.json({
          ...row,
          marketId,
          yesPrice: "0.5",
          noPrice: "0.5",
        });
      });
    const feed = await pantaCatalog(transport, "test-secret");
    expect(feed.markets).toHaveLength(25);
    expect(peak).toBeLessThanOrEqual(4);
    expect(transport).toHaveBeenCalledTimes(21);
    const mismatch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ items: [row] }))
      .mockResolvedValueOnce(
        Response.json({ ...row, marketId: "2".repeat(32), yesPrice: "0.5" }),
      );
    expect(
      (await pantaCatalog(mismatch, "test-secret")).markets[0].tradable,
    ).toBe(false);
  });
});
