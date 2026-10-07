import { describe, it, expect } from "vitest";
import {
  historySchema,
  replay,
  strategies,
  type History,
} from "../../src/features/backtesting/backtest";
const buy = (
  id = "1",
  owner = "a",
  position = "p",
  timestamp = 1,
): History => ({
  id,
  ownerPubkey: owner,
  positionPubkey: position,
  marketId: "m" + position,
  eventId: "e" + position,
  timestamp,
  eventType: "order_filled",
  isBuy: true,
  isYes: true,
  filledContractsMicro: "100000000",
  contractsSettledMicro: "0",
  avgFillPriceUsd: "500000",
  payoutAmountUsd: "0",
  feeUsd: null,
  eventMetadata: { title: "Event" },
  marketMetadata: { title: "Market" },
});
const payout = (timestamp = 2): History => ({
  ...buy("2", "a", "p", timestamp),
  eventType: "payout_claimed",
  isBuy: false,
  filledContractsMicro: "0",
  contractsSettledMicro: "100000000",
  payoutAmountUsd: "100000000",
});
const balanced = strategies[1];
describe("historical replay", () => {
  it("uses chronology and ignores duplicates", () => {
    const r = replay([payout(), buy(), buy()], "100000000", balanced, 0, 0);
    expect(r.copied).toBe(1);
    expect(r.realizedPnl).toBe("10000000");
    expect(r.cash).toBe("110000000");
  });
  it("never settles from current market metadata on a buy", () => {
    const r = replay([buy()], "100000000", balanced, 0, 0);
    expect(r.realizedPnl).toBe("0");
    expect(r.openPositions).toBe(1);
    expect(r.openCost).toBe("10000000");
  });
  it("applies fee and slippage assumptions, not leader fees", () => {
    const zero = replay([buy(), payout()], "100000000", balanced, 0, 0),
      costly = replay([buy(), payout()], "100000000", balanced, 100, 100);
    expect(BigInt(costly.realizedPnl)).toBeLessThan(BigInt(zero.realizedPnl));
    expect(BigInt(costly.modeledFees)).toBeGreaterThan(0n);
  });
  it("supports a $5 allocated entry with assumed fees", () => {
    expect(replay([buy()], "100000000", strategies[0], 100, 100).copied).toBe(
      1,
    );
  });
  it("follows proportional sell quantities", () => {
    const sell = {
      ...buy("2", "a", "p", 2),
      isBuy: false,
      filledContractsMicro: "50000000",
      avgFillPriceUsd: "600000",
    };
    const r = replay([buy(), sell], "100000000", balanced, 0, 0);
    expect(r.realizedPnl).toBe("1000000");
    expect(r.openCost).toBe("5000000");
  });
  it("hold strategy leaves an early sold position open without inventing resolution", () => {
    const sell = { ...buy("2", "a", "p", 2), isBuy: false };
    expect(
      replay([buy(), sell], "100000000", strategies[2], 0, 0).openPositions,
    ).toBe(1);
  });
  it("does not infer payout without observed settlement quantity", () => {
    const r = replay(
      [buy(), { ...payout(), contractsSettledMicro: "0" }],
      "100000000",
      balanced,
      0,
      0,
    );
    expect(r.openPositions).toBe(1);
    expect(r.realizedPnl).toBe("0");
  });
  it("retains cash reserve and exact ledger identity", () => {
    const hs = Array.from({ length: 30 }, (_, i) =>
      buy(String(i + 1), ["a", "b", "c"][i % 3], String(i), i),
    );
    const r = replay(hs, "100000000", balanced, 100, 100);
    expect(BigInt(r.cash)).toBeGreaterThanOrEqual(20000000n);
    expect(BigInt(r.cash) + BigInt(r.openCost)).toBe(
      100000000n + BigInt(r.realizedPnl),
    );
  });
  it("keeps losing events and realized drawdown in the sample", () => {
    const loss = {
      ...buy("2", "a", "p", 2),
      eventType: "position_lost",
      isBuy: false,
    };
    const r = replay([buy(), loss], "100000000", balanced, 0, 0);
    expect(r.realizedPnl).toBe("-10000000");
    expect(r.realizedDrawdown).toBe("10000000");
  });
  it("rejects malformed financial fields", () => {
    expect(() =>
      historySchema.parse({ ...buy(), avgFillPriceUsd: "0.5" }),
    ).toThrow();
  });
});
