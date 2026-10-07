import { expect, it, vi } from "vitest";
import { readAgentActivity } from "../../src/features/copy-trading/agent-source";
const trader = "DVHD66wYT5wFcgJ9K2SbtJTmbsJxzz6chkAzNwzbksdT";
const now = 1700000000000;
const fill = (id: string, changes = {}) => ({
  id,
  ownerPubkey: trader,
  eventType: "order_filled",
  timestamp: now / 1000 - 60,
  marketId: "market",
  eventId: "event",
  isBuy: true,
  isYes: true,
  filledContractsMicro: "20000000",
  avgFillPriceUsd: "500000",
  signature: null,
  eventMetadata: { title: "Synthetic activity" },
  ...changes,
});
const page = (data: unknown[], hasNext = false) => ({
  data,
  pagination: { end: data.length, hasNext },
});
it("reads one owned page and distinguishes fills from other history events without proposing trades", async () => {
  const request = vi.fn(async (path: string) => {
    expect(path).toBe("/history?ownerPubkey=" + trader + "&start=0&end=100");
    return page(
      [
        {
          id: "4",
          ownerPubkey: trader,
          eventType: "order_created",
          timestamp: now / 1000,
        },
        fill("3", { isBuy: false, isYes: false, timestamp: now / 1000 - 10 }),
        fill("2"),
        fill("1", { timestamp: now / 1000 - 120 }),
      ],
      true,
    );
  });
  const r = await readAgentActivity(trader, request, () => now);
  expect(request).toHaveBeenCalledOnce();
  expect(r.sampledEvents).toBe(4);
  expect(r.buys).toBe(2);
  expect(r.sells).toBe(1);
  expect(r.lastFillAt).toBe(now - 10000);
  expect(r.hasMoreEvents).toBe(true);
  expect(r.recentFills[0]).toMatchObject({
    action: "sell",
    side: "no",
    quantity: "20000000",
    price: "500000",
  });
  expect(r).not.toHaveProperty("decisions");
});
it("keeps an empty page distinct from unavailable provider history", async () => {
  const empty = await readAgentActivity(
    trader,
    async () => page([]),
    () => now,
  );
  expect(empty.lastFillAt).toBeNull();
  expect(empty.sampledEvents).toBe(0);
  await expect(
    readAgentActivity(
      trader,
      async () => {
        throw Error("Provider unavailable");
      },
      () => now,
    ),
  ).rejects.toThrow("Provider unavailable");
});
it("rejects foreign owners, inconsistent duplicates, malformed fills and out-of-order records", async () => {
  for (const records of [
    [fill("1", { ownerPubkey: "11111111111111111111111111111111" })],
    [fill("1"), fill("1", { avgFillPriceUsd: "600000" })],
    [fill("1", { filledContractsMicro: "invalid" })],
    [fill("1"), fill("2")],
  ])
    await expect(
      readAgentActivity(
        trader,
        async () => page(records),
        () => now,
      ),
    ).rejects.toThrow();
});
it("deduplicates consistent events, excludes unusable fills and caps the visible list", async () => {
  const records = [
    fill("10", { timestamp: now / 1000 + 1 }),
    fill("9", { avgFillPriceUsd: "0" }),
    fill("8", { filledContractsMicro: "0" }),
    ...[7, 6, 5, 4, 3, 2, 1].map((id) => fill(String(id))),
    fill("1"),
  ];
  const r = await readAgentActivity(
    trader,
    async () => page(records),
    () => now,
  );
  expect(r.sampledEvents).toBe(10);
  expect(r.excludedFills).toBe(3);
  expect(r.buys).toBe(7);
  expect(r.recentFills).toHaveLength(5);
});
