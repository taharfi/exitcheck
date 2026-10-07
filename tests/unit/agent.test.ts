import { afterEach, expect, it, vi } from "vitest";
import { AgentStore } from "../../src/features/copy-trading/agent-store";
import {
  readAgentHistory,
  type AgentFill,
} from "../../src/features/copy-trading/agent-source";
import {
  collectAgentPlan,
  proposeAgentFill,
  type AgentQuote,
} from "../../src/features/copy-trading/agent-collector";
import { agentSettings } from "../../src/features/copy-trading/agent-model";

const wallet = "11111111111111111111111111111111",
  trader = "DVHD66wYT5wFcgJ9K2SbtJTmbsJxzz6chkAzNwzbksdT",
  now = 1700000000000;
const stores: AgentStore[] = [];
const setup = async () => {
  const store = new AgentStore(":memory:");
  stores.push(store);
  const plan = await store.create(
    wallet,
    { trader, budget: "100", entry: "10" },
    now - 10000,
  );
  return { store, plan };
};
afterEach(() => {
  for (const store of stores.splice(0)) store.db.close();
});
function fill(id: string, overrides: Partial<AgentFill> = {}): AgentFill {
  return {
    id,
    ownerPubkey: trader,
    eventType: "order_filled",
    timestamp: now / 1000 - 1,
    marketId: "market-1",
    eventId: "event-1",
    isBuy: true,
    isYes: true,
    filledContractsMicro: "20000000",
    avgFillPriceUsd: "600000",
    signature: null,
    eventMetadata: { title: "Synthetic test event" },
    marketMetadata: null,
    ...overrides,
  };
}
const page = (data: unknown[], hasNext = false, end = 100) => ({
  data,
  pagination: { hasNext, end },
});
const quote: AgentQuote = {
  marketId: "market-1",
  eventId: "event-1",
  title: "Synthetic test event",
  status: "open",
  result: null,
  closeTime: now / 1000 + 3600,
  provider: "polymarket",
  pricing: { buyYesPriceUsd: "610000", buyNoPriceUsd: "400000" },
  at: now,
};
const requestFor = (data: unknown[]) => async (path: string) =>
  path.startsWith("/history?")
    ? page(data)
    : path === "/trading-status"
      ? { trading_active: true }
      : quote;

it("validates useful minimum entries and rejects self-copy", async () => {
  expect(
    agentSettings.safeParse({ trader, budget: "25", entry: "5" }).success,
  ).toBe(true);
  for (const settings of [
    { budget: "24", entry: "5" },
    { budget: "100", entry: "4.99" },
    { budget: "100", entry: "21" },
    { budget: "100", entry: "5.001" },
    { budget: "abc", entry: "10" },
    { budget: "100", entry: "-1" },
    { budget: "100", entry: "1.1234567" },
    { budget: "", entry: "10" },
  ])
    expect(agentSettings.safeParse({ trader, ...settings }).success).toBe(
      false,
    );
  const { store } = await setup();
  await expect(
    store.create(trader, { trader, budget: "100", entry: "10" }, now),
  ).rejects.toThrow(/different trader/);
});
it("sets a baseline without turning existing history into copy proposals", async () => {
  const { store, plan } = await setup();
  await collectAgentPlan(store, plan, requestFor([fill("1")]), () => now);
  expect((await store.get(wallet))?.cursor?.id).toBe("1");
  expect(await store.decisions(plan.id, now)).toEqual([]);
});
it("collects wallet-specific fills once, keeps sell signals separate and reserves proposal amounts only", async () => {
  const { store, plan } = await setup();
  const baseline = fill("1");
  await collectAgentPlan(store, plan, requestFor([baseline]), () => now);
  const request = requestFor([
    fill("3", { isBuy: false }),
    fill("2"),
    baseline,
  ]);
  await collectAgentPlan(store, (await store.get(wallet))!, request, () => now);
  expect(
    (await store.decisions(plan.id, now)).map((d) => d.status).sort(),
  ).toEqual(["exit_signal", "review"]);
  expect((await store.reservations(plan.id, now)).total).toBe(10000000n);
  await collectAgentPlan(store, (await store.get(wallet))!, request, () => now);
  expect(await store.decisions(plan.id, now)).toHaveLength(2);
  expect((await store.reservations(plan.id, now)).total).toBe(10000000n);
});
it("follows advancing pages until the previous event boundary is found", async () => {
  const baseline = await readAgentHistory(trader, null, async () =>
    page([fill("1")]),
  );
  const paths: string[] = [];
  const next = await readAgentHistory(trader, baseline.cursor, async (path) => {
    paths.push(path);
    return paths.length === 1
      ? page([fill("3")], true, 100)
      : page([fill("2"), fill("1")]);
  });
  expect(next.fills.map((f) => f.id)).toEqual(["2", "3"]);
  expect(next.pages).toBe(2);
  expect(paths[1]).toContain("start=100&end=200");
});
it("pauses on a missing boundary and never invents a successful observation", async () => {
  const { store, plan } = await setup();
  await collectAgentPlan(store, plan, requestFor([fill("1")]), () => now);
  await collectAgentPlan(
    store,
    (await store.get(wallet))!,
    requestFor([fill("2")]),
    () => now + 1000,
  );
  expect((await store.get(wallet))?.status).toBe("paused");
  expect((await store.get(wallet))?.error).toMatch(/boundary/);
  expect((await store.get(wallet))?.lastSuccess).toBe(now);
  expect(await store.decisions(plan.id, now)).toEqual([]);
});
it("rejects a wrong owner, changed boundary and ascending history order", async () => {
  const cursor = (
    await readAgentHistory(trader, null, async () => page([fill("1")]))
  ).cursor;
  await expect(
    readAgentHistory(trader, cursor, async () =>
      page([fill("2", { ownerPubkey: wallet }), fill("1")]),
    ),
  ).rejects.toThrow(/different wallet/);
  await expect(
    readAgentHistory(trader, cursor, async () =>
      page([fill("1", { filledContractsMicro: "999" })]),
    ),
  ).rejects.toThrow(/boundary changed/);
  await expect(
    readAgentHistory(trader, null, async () => page([fill("1"), fill("2")])),
  ).rejects.toThrow(/newest-first/);
});
it("bounds pagination and rejects stalled pages rather than authorizing incomplete history", async () => {
  const cursor = (
    await readAgentHistory(trader, null, async () => page([fill("1")]))
  ).cursor;
  let pages = 0;
  await expect(
    readAgentHistory(trader, cursor, async () =>
      page([fill(String(10 - pages++))], true, pages * 100),
    ),
  ).rejects.toThrow(/four-page/);
  expect(pages).toBe(4);
  await expect(
    readAgentHistory(trader, cursor, async () => page([fill("2")], true, 0)),
  ).rejects.toThrow(/stopped advancing/);
});
it("does not let an in-flight poll undo a pause or insert proposals", async () => {
  const { store, plan } = await setup();
  const baseline = fill("1");
  await collectAgentPlan(store, plan, requestFor([baseline]), () => now);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const polling = collectAgentPlan(
    store,
    (await store.get(wallet))!,
    async (path) => {
      if (path.startsWith("/history?")) await held;
      return await requestFor([fill("2"), baseline])(path);
    },
    () => now,
  );
  await store.change(wallet, "pause", now);
  release();
  expect(await polling).toBe(false);
  expect((await store.get(wallet))?.status).toBe("paused");
  expect(await store.decisions(plan.id, now)).toEqual([]);
});
it("does not allow overlapping collectors or an expired lease to commit", async () => {
  const { store, plan } = await setup(),
    request = vi.fn(requestFor([fill("1")]));
  const first = (await store.acquire(plan, now))!;
  expect(await collectAgentPlan(store, plan, request, () => now)).toBe(false);
  expect(request).not.toHaveBeenCalled();
  expect(await store.commit(plan, first, plan, [], now + 300001)).toBe(false);
  const second = (await store.acquire(plan, now + 300001))!;
  await store.release(plan.id, first);
  expect(await store.commit(plan, second, plan, [], now + 300002)).toBe(true);
});
it("rejects an old plan action after the wallet creates a replacement", async () => {
  const { store, plan } = await setup();
  await store.change(wallet, "stop", now);
  const replacement = await store.create(
    wallet,
    { trader, budget: "100", entry: "10" },
    now + 1,
  );
  await expect(store.change(wallet, "pause", now + 2, plan.id)).rejects.toThrow(
    /no longer current/,
  );
  expect((await store.get(wallet))?.id).toBe(replacement.id);
  expect((await store.get(wallet))?.status).toBe("watching");
});
it("resumes from a new baseline and preserves idempotent resume", async () => {
  const { store, plan } = await setup();
  await collectAgentPlan(store, plan, requestFor([fill("1")]), () => now);
  const running = await store.change(wallet, "resume", now + 10);
  expect(running.cursor?.id).toBe("1");
  await store.change(wallet, "pause", now + 20);
  const resumed = await store.change(wallet, "resume", now + 30);
  expect(resumed.cursor).toBeNull();
  expect(resumed.acceptAfter).toBe(now + 30);
  await collectAgentPlan(
    store,
    resumed,
    requestFor([fill("2"), fill("1")]),
    () => now + 40,
  );
  expect(await store.decisions(plan.id, now)).toEqual([]);
  await store.change(wallet, "stop", now + 50);
  await expect(store.change(wallet, "pause", now + 60)).rejects.toThrow(
    /stopped/,
  );
  await expect(store.change(wallet, "resume", now + 60)).rejects.toThrow(
    /ended|stopped/,
  );
});
it("enforces price, freshness, market identity and proposal allocation ceilings", async () => {
  const { store, plan } = await setup();
  const reserved = await store.reservations(plan.id, now),
    source = fill("2");
  expect(
    proposeAgentFill(plan, source, quote, true, reserved, now).status,
  ).toBe("review");
  for (const q of [
    { ...quote, marketId: "wrong" },
    { ...quote, eventId: "wrong" },
    { ...quote, provider: "unreviewed" },
    { ...quote, result: "yes" as const },
    { ...quote, closeTime: now / 1000 - 1 },
    { ...quote, at: now - 20001 },
    { ...quote, at: now + 1 },
    { ...quote, pricing: { buyYesPriceUsd: "618001", buyNoPriceUsd: "0" } },
  ])
    expect(proposeAgentFill(plan, source, q, true, reserved, now).status).toBe(
      "skipped",
    );
  expect(
    proposeAgentFill(plan, source, quote, false, reserved, now).status,
  ).toBe("skipped");
  expect(
    proposeAgentFill(
      plan,
      fill("2", { timestamp: now / 1000 - 121 }),
      quote,
      true,
      reserved,
      now,
    ).status,
  ).toBe("skipped");
  expect(
    proposeAgentFill(
      plan,
      fill("2", { timestamp: now / 1000 + 6 }),
      quote,
      true,
      reserved,
      now,
    ).status,
  ).toBe("skipped");
  expect(
    proposeAgentFill(
      plan,
      source,
      quote,
      true,
      { total: 71000000n, events: new Map() },
      now,
    ).reason,
  ).toMatch(/80%/);
  expect(
    proposeAgentFill(
      plan,
      source,
      quote,
      true,
      { total: 20000000n, events: new Map([[source.eventId, 20000000n]]) },
      now,
    ).reason,
  ).toMatch(/20%/);
});
it("counts proposals in the same poll against combined event limits", async () => {
  const { store, plan } = await setup();
  const baseline = fill("1");
  await collectAgentPlan(store, plan, requestFor([baseline]), () => now);
  await collectAgentPlan(
    store,
    (await store.get(wallet))!,
    requestFor([fill("4"), fill("3"), fill("2"), baseline]),
    () => now,
  );
  const decisions = await store.decisions(plan.id, now);
  expect(decisions.filter((d) => d.status === "review")).toHaveLength(2);
  expect(decisions.find((d) => d.status === "skipped")?.reason).toMatch(/20%/);
  expect((await store.reservations(plan.id, now)).total).toBe(20000000n);
  expect((await store.reservations(plan.id, now + 120000)).total).toBe(0n);
  expect(
    (await store.decisions(plan.id, now + 120000)).filter(
      (d) => d.status === "expired",
    ),
  ).toHaveLength(2);
});
it("retains the boundary after provider failure so recovery cannot double-copy", async () => {
  const { store, plan } = await setup();
  await collectAgentPlan(store, plan, requestFor([fill("1")]), () => now);
  await collectAgentPlan(
    store,
    (await store.get(wallet))!,
    async () => {
      throw new (await import("../../src/lib/errors")).AppError(
        "PROVIDER_TIMEOUT",
        "Source unavailable",
        502,
      );
    },
    () => now + 10,
  );
  expect((await store.get(wallet))?.cursor?.id).toBe("1");
  expect((await store.get(wallet))?.status).toBe("watching");
  expect((await store.get(wallet))?.error).toBe("Source unavailable");
});
