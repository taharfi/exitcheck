import { describe, expect, it, vi } from "vitest";
import { gammaCatalog } from "@/features/trade/markets";
import { marketFeedSchema } from "@/features/trade/types";
const item = (id: number) => ({
  id: String(id),
  question: `Will event ${id} happen?`,
  slug: `event-${id}`,
  active: true,
  closed: false,
  endDate: new Date(Date.now() + 86400000).toISOString(),
  outcomes: '["Yes","No"]',
  outcomePrices: '["0.6","0.4"]',
  description: "Resolution rules",
  acceptingOrders: true,
});
describe("expanded live catalog", () => {
  it("loads ten distinct pages with bounded concurrency and supports over 100 contracts", async () => {
    let active = 0,
      peak = 0;
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("order")).toBe("volume24hr");
        expect(url.searchParams.get("limit")).toBe("100");
        active++;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active--;
        const offset = Number(url.searchParams.get("offset"));
        return Response.json(
          Array.from({ length: 100 }, (_, i) => item(offset + i)),
        );
      });
    const catalog = await gammaCatalog(transport);
    expect(catalog.markets).toHaveLength(1000);
    expect(new Set(catalog.markets.map((m) => m.id)).size).toBe(1000);
    expect(transport).toHaveBeenCalledTimes(10);
    expect(peak).toBeLessThanOrEqual(3);
    expect(catalog.warnings).toEqual([]);
    expect(
      marketFeedSchema.parse({ ...catalog, capturedAt: Date.now() }).markets,
    ).toHaveLength(1000);
  });
  it("preserves successful pages, removes duplicates and marks partial failure", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) => {
        const offset = Number(
          new URL(String(input)).searchParams.get("offset"),
        );
        if (offset === 100) throw Error("Provider unavailable");
        return Response.json(
          offset === 0
            ? Array.from({ length: 100 }, (_, i) => item(i))
            : [item(0), item(200)],
        );
      });
    const catalog = await gammaCatalog(transport);
    expect(catalog.markets).toHaveLength(101);
    expect(catalog.warnings[0]).toMatch(/incomplete/);
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it("never substitutes example markets when every page fails", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockRejectedValue(Error("Unavailable"));
    await expect(gammaCatalog(transport)).rejects.toThrow(
      /Polymarket feed unavailable/,
    );
  });
});
