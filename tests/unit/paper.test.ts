import { describe, it, expect } from "vitest";
import {
  startPaper,
  tradeSchema,
  evaluatePaper,
  type Trade,
  type Quote,
} from "../../src/features/copy-trading/paper";
const now = 1800000000000,
  owners = ["a", "b", "c"];
const trade = (id = "1", owner = "a", market = "m", event = "e"): Trade => ({
  id,
  ownerPubkey: owner,
  marketId: market,
  eventId: event,
  eventTitle: "Event",
  marketTitle: "Market",
  timestamp: String(now / 1000),
  action: "buy",
  side: "yes",
  amountUsd: "100000000",
  priceUsd: "500000",
});
const quote = (marketId = "m"): Quote => ({
  marketId,
  status: "open",
  result: null,
  provider: "polymarket",
  closeTime: now / 1000 + 10000,
  yes: "500000",
  no: "500000",
  retrievedAt: now,
});
const start = () => startPaper("100000000", owners, now - 1000);
describe("paper portfolio risk rules", () => {
  it("supports one wallet and preserves the 30% reserve", () => {
    const p = startPaper("100000000", ["a"], now - 1000);
    const trades = Array.from({ length: 20 }, (_, i) =>
      trade(String(i), "a", "m" + i, "e" + i),
    );
    const result = evaluatePaper(
      p,
      trades,
      trades.map((t) => quote(t.marketId)),
      now,
    );
    expect(result.owners).toEqual(["a"]);
    expect(result.cash).toBe("30000000");
    expect(result.positions).toHaveLength(14);
  });
  it("rejects an empty or duplicated wallet selection", () => {
    expect(() => startPaper("100000000", [])).toThrow();
    expect(() => startPaper("100000000", ["a", "a"])).toThrow();
  });
  it("normalizes numeric provider timestamps without rounding financial fields", () => {
    const parsed = tradeSchema.parse({ ...trade(), timestamp: now / 1000 });
    expect(parsed.timestamp).toBe(String(now / 1000));
    expect(parsed.priceUsd).toBe("500000");
  });
  it("allocates exact micro units and never duplicates a signal", () => {
    const p = evaluatePaper(start(), [trade()], [quote()], now);
    expect(p.cash).toBe("95000000");
    expect(p.positions[0].contracts).toBe("10000000");
    expect(evaluatePaper(p, [trade()], [quote()], now).positions).toHaveLength(
      1,
    );
  });
  it("does not replay trades before portfolio creation", () => {
    expect(
      evaluatePaper(
        startPaper("100000000", owners, now + 1),
        [trade()],
        [quote()],
        now,
      ).positions,
    ).toHaveLength(0);
  });
  it("skips late signals and price deterioration", () => {
    expect(
      evaluatePaper(start(), [trade()], [quote()], now + 130000).positions,
    ).toHaveLength(0);
    expect(
      evaluatePaper(start(), [trade()], [{ ...quote(), yes: "526000" }], now)
        .positions,
    ).toHaveLength(0);
  });
  it("caps shared event exposure even across wallets", () => {
    const p = evaluatePaper(
      start(),
      [trade("1", "a", "m1"), trade("2", "b", "m2"), trade("3", "c", "m3")],
      [quote("m1"), quote("m2"), quote("m3")],
      now,
    );
    expect(p.positions).toHaveLength(2);
    expect(p.journal[0].decision).toBe("Skipped");
  });
  it("caps caller exposure and preserves reserve", () => {
    const ts = Array.from({ length: 20 }, (_, i) =>
      trade(String(i), owners[i % 3], "m" + i, "e" + i),
    );
    const p = evaluatePaper(
      start(),
      ts,
      ts.map((t) => quote(t.marketId)),
      now,
    );
    expect(BigInt(p.cash)).toBeGreaterThanOrEqual(30000000n);
    for (const owner of owners)
      expect(
        p.positions
          .filter((x) => x.owner === owner)
          .reduce((s, x) => s + BigInt(x.cost), 0n),
      ).toBeLessThanOrEqual(23333333n);
  });
  it("settles once using official outcome and correct side", () => {
    const p = evaluatePaper(start(), [trade()], [quote()], now);
    const q = { ...quote(), result: "yes" as const, status: "closed" };
    const settled = evaluatePaper(p, [], [q], now);
    expect(settled.cash).toBe("105000000");
    expect(evaluatePaper(settled, [], [q], now).cash).toBe("105000000");
  });
  it("pauses after realized losses without guaranteeing total loss cap", () => {
    const p = evaluatePaper(
      start(),
      [trade("1", "a", "m1", "e1"), trade("2", "b", "m2", "e2")],
      [quote("m1"), quote("m2")],
      now,
    );
    const qs = [quote("m1"), quote("m2")].map((q) => ({
      ...q,
      result: "no" as const,
      status: "closed",
    }));
    expect(evaluatePaper(p, [], qs, now).paused).toBe(true);
  });
  it("skips missing quotes, unsupported markets, and sells", () => {
    expect(evaluatePaper(start(), [trade()], [], now).positions).toHaveLength(
      0,
    );
    expect(
      evaluatePaper(
        start(),
        [trade()],
        [{ ...quote(), provider: "bisonfi" }],
        now,
      ).positions,
    ).toHaveLength(0);
    expect(
      evaluatePaper(start(), [{ ...trade(), action: "sell" }], [quote()], now)
        .positions,
    ).toHaveLength(0);
  });
});
