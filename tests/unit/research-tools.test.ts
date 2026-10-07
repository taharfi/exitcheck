import { describe, it, expect } from "vitest";
import { importHistory } from "../../src/features/traders/history-loader";
import { AppError } from "../../src/lib/errors";
import {
  summarizeOverlap,
  type Exposure,
} from "../../src/features/traders/overlap";
import {
  parseWatchlist,
  toggleSaved,
} from "../../src/features/traders/watchlist";
const owner = "E1Uc6BvyLS1cP47yuYq4sGQqbQPrrH6YKVuth88NzeHm";
const event = (id = "1") => ({
  id,
  eventType: "order_filled",
  ownerPubkey: owner,
  positionPubkey: "p",
  marketId: "m",
  eventId: "e",
  timestamp: 10,
  isBuy: true,
  isYes: true,
  filledContractsMicro: "1000000",
  contractsSettledMicro: "0",
  avgFillPriceUsd: "500000",
  payoutAmountUsd: "0",
  feeUsd: null,
  eventMetadata: null,
  marketMetadata: null,
});
const pos = (
  id: string,
  wallet: string,
  side: "yes" | "no" = "yes",
  value: string | null = "1000000",
): Exposure => ({
  id,
  owner: wallet,
  side,
  value,
  eventId: "e",
  marketId: "m",
  title: "Event",
});
describe("history coverage", () => {
  it("deduplicates forward pages and reports provider totals", async () => {
    let calls = 0;
    const r = await importHistory(owner, async () =>
      ++calls === 1
        ? { data: [event()], pagination: { end: 1, total: 2, hasNext: true } }
        : {
            data: [event(), event("2")],
            pagination: { end: 2, total: 2, hasNext: false },
          },
    );
    expect(r.history).toHaveLength(2);
    expect(r.complete).toBe(true);
    expect(r.pages).toBe(2);
    expect(r.reportedTotal).toBe(2);
  });
  it("stops a stalled cursor without implying full coverage", async () => {
    let calls = 0;
    const r = await importHistory(owner, async () =>
      ++calls === 1
        ? { data: [event()], pagination: { end: 1, total: 5, hasNext: true } }
        : { data: [], pagination: { end: 1, total: 5, hasNext: true } },
    );
    expect(r.complete).toBe(false);
    expect(r.stopReason).toContain("stopped advancing");
    expect(r.history).toHaveLength(1);
  });
  it("retains verified early events after later transport failure", async () => {
    let calls = 0;
    const r = await importHistory(owner, async () => {
      if (++calls === 1)
        return {
          data: [event()],
          pagination: { end: 1, total: 5, hasNext: true },
        };
      throw new AppError("RATE_LIMIT", "Limited", 429);
    });
    expect(r.history).toHaveLength(1);
    expect(r.complete).toBe(false);
    expect(r.stopReason).toContain("RATE_LIMIT");
  });
  it("does not convert first-page failure into an empty wallet", async () => {
    await expect(
      importHistory(owner, async () => {
        throw new AppError("PROVIDER_TIMEOUT", "Timeout", 502);
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
  });
  it("rejects wrong-owner events", async () => {
    await expect(
      importHistory(owner, async () => ({
        data: [{ ...event(), ownerPubkey: "wrong" }],
        pagination: { end: 1, hasNext: false },
      })),
    ).rejects.toMatchObject({ code: "HISTORY_OWNER" });
  });
});
describe("current event overlap", () => {
  it("counts distinct wallets and deduplicates positions", () => {
    const a = pos("1", "a");
    const groups = summarizeOverlap([a, a, pos("2", "b")]);
    expect(groups[0].positions).toBe(2);
    expect(groups[0].markedValue).toBe("2000000");
    expect(groups[0].owners).toHaveLength(2);
  });
  it("does not mistake many positions from one wallet for overlap", () => {
    expect(summarizeOverlap([pos("1", "a"), pos("2", "a")])).toEqual([]);
  });
  it("flags opposing sides without treating them as a guaranteed hedge", () => {
    expect(
      summarizeOverlap([pos("1", "a"), pos("2", "b", "no")])[0].opposingSides,
    ).toBe(true);
  });
  it("preserves unknown mark values and missing event grouping", () => {
    const g = summarizeOverlap([
      { ...pos("1", "a"), eventId: null },
      { ...pos("2", "b", "yes", null), eventId: null },
    ])[0];
    expect(g.markedValue).toBeNull();
    expect(g.eventVerified).toBe(false);
  });
});
describe("saved wallets", () => {
  it("adds/removes without duplicate records", () => {
    expect(toggleSaved([], owner)).toEqual([owner]);
    expect(toggleSaved([owner], owner)).toEqual([]);
  });
  it("rejects corrupt storage and duplicated addresses", () => {
    expect(() => parseWatchlist("not-json")).toThrow();
    expect(() => parseWatchlist(JSON.stringify([owner, owner]))).toThrow();
    expect(() => toggleSaved([], "invalid")).toThrow();
  });
});
