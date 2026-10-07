import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ShadowStore,
  publicShadow,
  sessionHash,
} from "../../src/features/copy-trading/shadow-store";
import {
  collectShadow,
  observation,
} from "../../src/features/copy-trading/shadow-collector";
import { startPaper, type Trade } from "../../src/features/copy-trading/paper";
import { copyability } from "../../src/features/traders/copyability";
import { AppError } from "../../src/lib/errors";
const now = 1800000000000;
const trade = (id = "1", owner = "a", market = "m"): Trade => ({
  id,
  ownerPubkey: owner,
  marketId: market,
  eventId: "e",
  eventTitle: "Event",
  marketTitle: "Market",
  timestamp: String(now / 1000),
  action: "buy",
  side: "yes",
  amountUsd: "100000000",
  priceUsd: "500000",
});
const market = {
  marketId: "m",
  title: "Market",
  provider: "polymarket",
  status: "open",
  result: null,
  closeTime: now / 1000 + 1000,
  pricing: { buyYesPriceUsd: "500000", buyNoPriceUsd: "500000" },
};
let store: ShadowStore;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  store = new ShadowStore(":memory:");
});
afterEach(() => {
  store.db.close();
  vi.useRealTimers();
});
async function start(session = "s", owners = ["a"]) {
  return await store.create(
    session,
    startPaper("100000000", owners, now - 1000),
    now - 1000,
  );
}
describe("durable shadow collection", () => {
  it("records indicative evidence, models one entry, and deduplicates repeated polls", async () => {
    await start();
    const request = async (path: string) =>
      path === "/trades" ? { data: [trade()] } : market;
    await collectShadow(store, request, now);
    await collectShadow(store, request, now);
    expect((await store.get("s"))!.paper.cash).toBe("95000000");
    expect((await store.get("s"))!.paper.positions).toHaveLength(1);
    expect(await store.observations("a")).toHaveLength(1);
    expect((await store.observations("a"))[0].premiumBps).toBe("0");
  });
  it("skips quote outages and preserves the failed quote observation", async () => {
    await start();
    await collectShadow(
      store,
      async (path) => {
        if (path === "/trades") return { data: [trade()] };
        throw new AppError("PROVIDER_TIMEOUT", "Timeout", 502);
      },
      now,
    );
    expect((await store.get("s"))!.paper.positions).toHaveLength(0);
    expect((await store.get("s"))!.paper.journal[0].reason).toContain(
      "quote is unavailable",
    );
    expect((await store.observations("a"))[0].quote).toBeNull();
  });
  it("preserves cash on feed failures and records interruption on recovery", async () => {
    await start();
    await collectShadow(store, async () => ({ data: [] }), now);
    vi.setSystemTime(now + 120000);
    await collectShadow(
      store,
      async () => {
        throw new AppError("RATE_LIMIT", "Rate limit", 429);
      },
      now + 120000,
    );
    expect((await store.get("s"))!.error).toBe("RATE_LIMIT");
    expect((await store.get("s"))!.lastSuccess).toBe(now);
    await collectShadow(store, async () => ({ data: [] }), now + 120000);
    expect((await store.get("s"))!.gaps).toBe(1);
    expect((await store.get("s"))!.paper.cash).toBe("100000000");
  });
  it("does not import earlier signals or replay signals from a pause interval", async () => {
    const row = await start();
    row.acceptAfter = now + 1;
    await store.save(row);
    await collectShadow(
      store,
      async (path) => (path === "/trades" ? { data: [trade()] } : market),
      now,
    );
    expect((await store.get("s"))!.paper.journal).toHaveLength(0);
    expect(await store.observations("a")).toHaveLength(0);
  });
  it("does not collect paused or expired portfolios", async () => {
    const row = await start();
    row.paper.paused = true;
    await store.save(row);
    const request = vi.fn();
    await collectShadow(store, request, now);
    expect(request).not.toHaveBeenCalled();
    row.paper.paused = false;
    row.revision = (await store.get("s"))!.revision;
    await store.save(row);
    await collectShadow(store, request, now + 8 * 86400000);
    expect(request).not.toHaveBeenCalled();
  });
  it("blocks concurrent collectors and stale writes after a user pause", async () => {
    const original = await start();
    const lease = (await store.acquire(now))!;
    const request = vi.fn();
    await collectShadow(store, request, now);
    expect(request).not.toHaveBeenCalled();
    await store.release(lease);
    const paused = structuredClone(original);
    paused.paper.paused = true;
    expect(await store.save(paused)).toBe(true);
    expect(await store.save(original)).toBe(false);
    expect((await store.get("s"))!.paper.paused).toBe(true);
  });
  it("namespaces identical signal IDs across wallets", async () => {
    await start("s", ["a", "b"]);
    await collectShadow(
      store,
      async (path) =>
        path === "/trades"
          ? { data: [trade("1", "a", "m"), trade("1", "b", "m2")] }
          : { ...market, marketId: path.split("/").pop() },
      now,
    );
    expect((await store.get("s"))!.paper.positions).toHaveLength(2);
  });
  it("retains a portfolio and observations after database reopen", async () => {
    const directory = mkdtempSync(join(tmpdir(), "exitcheck-shadow-")),
      path = join(directory, "state.sqlite");
    const first = new ShadowStore(path);
    await first.create("private", startPaper("100000000", ["a"], now), now);
    await first.observe(observation(trade(), null, now));
    first.db.close();
    const reopened = new ShadowStore(path);
    expect((await reopened.get("private"))!.paper.cash).toBe("100000000");
    expect(await reopened.observations("a")).toHaveLength(1);
    reopened.db.close();
    rmSync(directory, { recursive: true });
  });
  it("does not expose browser session credentials in public snapshots", async () => {
    const row = await start();
    expect(publicShadow(row)).not.toHaveProperty("session");
    expect(sessionHash("token")).not.toBe("token");
  });
  it("fails capacity checks atomically and prevents silent replacement", async () => {
    await start();
    await expect(start()).rejects.toThrow("already exists");
    for (let i = 1; i < 25; i++) await start("s" + i);
    await expect(start("extra")).rejects.toThrow("25 portfolios");
    expect(await store.active(now)).toHaveLength(25);
  });
});
describe("copyability evidence", () => {
  it("reports unknown median and avoids an invented score for empty history", () => {
    const r = copyability(
      {
        at: now,
        history: [],
        complete: false,
        stopReason: "No records",
        pages: 1,
        reportedTotal: null,
        from: null,
        to: null,
      },
      "100000000",
    );
    expect(r.medianLeaderBuy).toBeNull();
    expect(r.proposedEntry).toBe("5000000");
    expect(r).not.toHaveProperty("score");
  });
  it("calculates exact median trade cost from fractional fills", () => {
    const base = {
      id: "1",
      eventType: "order_filled",
      ownerPubkey: "a",
      positionPubkey: "p",
      marketId: "m",
      eventId: "e",
      timestamp: 1,
      isBuy: true,
      isYes: true,
      filledContractsMicro: "1500000",
      contractsSettledMicro: "0",
      avgFillPriceUsd: "500000",
      payoutAmountUsd: "0",
      feeUsd: null,
      eventMetadata: null,
      marketMetadata: null,
    };
    const r = copyability(
      {
        at: now,
        history: [base, { ...base, id: "2", filledContractsMicro: "3500000" }],
        complete: false,
        stopReason: "Cap",
        pages: 1,
        reportedTotal: null,
        from: 1,
        to: 1,
      },
      "100000000",
    );
    expect(r.medianLeaderBuy).toBe("1250000");
    expect(r.holdingDuration).toBeNull();
    expect(r.assessment).toContain("Incomplete");
  });
});
