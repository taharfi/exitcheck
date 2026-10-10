import { describe, expect, it, vi } from "vitest";
import { pantaData } from "@/features/trade/panta-data";
import { normalizePanta } from "@/features/trade/panta";

const id = "1".repeat(32),
  other = "2".repeat(32);
const trade = {
  id: "1",
  marketId: id,
  wallet: id,
  isPrimary: true,
  yesAmount: "10",
  noAmount: "0",
  feePaid: "0.05",
  blockTime: 1_760_000_000,
  signature: "3".repeat(88),
  quoteAsset: "USDC",
};
describe("Panta read-only data", () => {
  it("returns only validated public trade fields and provider categories", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        Response.json(
          String(input).includes("/categories/")
            ? { categories: ["crypto"] }
            : {
                marketId: id,
                items: [
                  {
                    ...trade,
                    email: "private@example.com",
                    apiKeyId: "private-key",
                  },
                ],
              },
        ),
      );
    const result = await pantaData({ marketId: id }, transport, "secret");
    expect(result.trades).toEqual([trade]);
    expect(result.categories).toEqual(["crypto"]);
    expect(JSON.stringify(result)).not.toMatch(
      /secret|private@example|private-key/,
    );
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("rejects wrong identities without discarding independently valid categories", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        Response.json(
          String(input).includes("/categories/")
            ? { categories: ["crypto"] }
            : { marketId: other, items: [trade] },
        ),
      );
    const result = await pantaData({ marketId: id }, transport, "secret");
    expect(result.trades).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.categories).toEqual(["crypto"]);
  });
  it("preserves both sides and claim flags without inventing a dollar balance", async () => {
    const positions = ["yes", "no"].map((side) => ({
      marketId: id,
      category: "crypto",
      side,
      shares: "38.40",
      phase: "resolved",
      claimable: side === "yes",
      claimed: false,
      outcome: "yes",
    }));
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        Response.json(
          String(input).includes("/positions/")
            ? { wallet: id, positions }
            : { wallet: id, items: [] },
        ),
      );
    const result = await pantaData({ wallet: id }, transport, "secret");
    expect(result.positions).toEqual(positions);
    expect(result.positions[0]).not.toHaveProperty("valueUsd");
  });
  it("does not turn provider failures into empty successful history", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("", { status: 429 }));
    await expect(
      pantaData({ wallet: id }, transport, "secret"),
    ).rejects.toThrow(/unavailable/);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("rejects traversal and ambiguous queries before upstream requests", async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(
      pantaData({ marketId: "../account" }, transport, "secret"),
    ).rejects.toThrow();
    await expect(
      pantaData({ wallet: id, marketId: id }, transport, "secret"),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it("keeps total volume separate from 24-hour volume and suppresses settled prices", () => {
    const now = Date.now();
    const market = normalizePanta(
      {
        marketId: id,
        title: "A resolved market",
        category: "crypto",
        phase: "resolved",
        status: "resolved",
        resolved: true,
        startTime: 1,
        endTime: 2,
        resolutionTime: 3,
        volumeUsdc: "1200.00",
        primaryYesPrice: "0.5",
        secondaryYesPrice: "0.6",
      },
      now,
    );
    expect(market).toMatchObject({
      volume24h: null,
      liquidity: null,
      tradable: false,
      pantaDetails: {
        totalVolumeUsdc: 1200,
        primaryYesPrice: null,
        secondaryYesPrice: null,
      },
    });
  });
});
