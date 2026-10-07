import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { randomUUID } from "node:crypto";
vi.mock(
  "../../src/features/copy-trading/shadow-store",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/features/copy-trading/shadow-store")
      >();
    const store = new actual.ShadowStore(":memory:");
    return { ...actual, shadowStore: () => store };
  },
);
vi.mock(
  "../../src/features/copy-trading/agent-store",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/features/copy-trading/agent-store")
      >();
    const store = new actual.AgentStore(":memory:");
    return { ...actual, agentStore: () => store };
  },
);
import { GET, POST } from "../../src/app/api/agent/route";
import { POST as REVIEW } from "../../src/app/api/agent/review/route";
import type { AgentDecision } from "../../src/features/copy-trading/agent-model";
import { AuthStore, AUTH_COOKIE } from "../../src/features/account/auth";
import { shadowStore } from "../../src/features/copy-trading/shadow-store";
import { agentStore } from "../../src/features/copy-trading/agent-store";
import { JupiterProvider } from "../../src/lib/provider/jupiter";
import * as walletReads from "../../src/features/copy-trading/agent-wallet";
beforeEach(() => {
  vi.spyOn(walletReads, "readWalletFunds").mockRejectedValue(
    new Error("Synthetic RPC unavailable"),
  );
});
const origin = "http://127.0.0.1:3000",
  trader = "DVHD66wYT5wFcgJ9K2SbtJTmbsJxzz6chkAzNwzbksdT";
function request(cookie = "", body?: unknown, source = origin) {
  return new Request(origin + "/api/agent", {
    method: body ? "POST" : "GET",
    headers: { origin: source, cookie, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function login() {
  const key = nacl.sign.keyPair(),
    wallet = bs58.encode(key.publicKey),
    auth = new AuthStore(shadowStore()),
    challenge = await auth.challenge(wallet, origin);
  const signature = bs58.encode(
    nacl.sign.detached(
      new TextEncoder().encode(challenge.message),
      key.secretKey,
    ),
  );
  return {
    wallet,
    cookie: `${AUTH_COOKIE}=${(await auth.verify(challenge.token, signature, origin)).token}`,
  };
}
const start = {
  action: "start",
  settings: { trader, budget: "100", entry: "10" },
};
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await agentStore().db.exec(
    "DELETE FROM copy_agents; DELETE FROM copy_agent_decisions; DELETE FROM copy_agent_journal; DELETE FROM copy_agent_polls;",
  );
});
afterAll(() => {
  agentStore().db.close();
  shadowStore().db.close();
});
it("requires wallet proof and same-origin writes", async () => {
  expect((await POST(request("", start))).status).toBe(401);
  expect(
    (
      await POST(
        request((await login()).cookie, start, "https://other.example"),
      )
    ).status,
  ).toBe(403);
});
it("rejects invalid budgets and any execution flag, even when live execution is enabled elsewhere", async () => {
  const { cookie } = await login();
  expect(
    (
      await POST(
        request(cookie, {
          ...start,
          settings: { ...start.settings, entry: "21" },
        }),
      )
    ).status,
  ).toBe(422);
  expect(
    (await POST(request(cookie, { ...start, execute: true }))).status,
  ).toBe(422);
  expect(
    (
      await POST(
        request(cookie, {
          ...start,
          settings: { ...start.settings, budget: "abc" },
        }),
      )
    ).status,
  ).toBe(422);
  vi.stubEnv("ENABLE_LIVE_EXECUTION", "true");
  expect((await (await GET(request(cookie))).json()).execution).toBe(
    "disabled",
  );
});
it("keeps plans private, collects only GET provider reads and refuses stale plan actions", async () => {
  vi.stubEnv("AGENT_COLLECTOR_ENABLED", "true");
  vi.stubEnv("JUPITER_API_KEY", "nonsecret-test-key");
  const provider = vi
    .spyOn(JupiterProvider.prototype, "request")
    .mockResolvedValue({ data: [], pagination: { end: 0, hasNext: false } });
  const first = await login(),
    second = await login();
  const response = await POST(request(first.cookie, start));
  expect(response.status).toBe(200);
  const created = await response.json();
  expect(created.plan.cursor.id).toBe("0");
  expect(created.decisions).toEqual([]);
  expect(created.monitoring.baselines).toBe(1);
  expect(created.monitoring.fills).toBe(0);
  expect((await (await GET(request(first.cookie))).json()).plan.wallet).toBe(
    first.wallet,
  );
  expect((await (await GET(request(second.cookie))).json()).plan).toBeNull();
  expect(
    (await (await GET(request(second.cookie))).json()).monitoring,
  ).toBeNull();
  expect((await (await GET(request())).json()).plan).toBeNull();
  expect((await (await GET(request())).json()).monitoring).toBeNull();
  expect(
    (
      await POST(
        request(second.cookie, { action: "stop", planId: created.plan.id }),
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await POST(
        request(first.cookie, { action: "pause", planId: created.plan.id }),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await POST(
        request(first.cookie, { action: "refresh", planId: created.plan.id }),
      )
    ).status,
  ).toBe(409);
  expect(provider).toHaveBeenCalledTimes(1);
  expect(provider.mock.calls[0]).toHaveLength(1);
  expect(provider.mock.calls[0][0]).toContain("ownerPubkey=" + trader);
});
it("fails clearly when background observation or provider access is unavailable", async () => {
  const { cookie } = await login();
  vi.stubEnv("AGENT_COLLECTOR_ENABLED", "false");
  expect((await POST(request(cookie, start))).status).toBe(503);
  vi.stubEnv("AGENT_COLLECTOR_ENABLED", "true");
  vi.stubEnv("JUPITER_API_KEY", "");
  expect((await POST(request(cookie, start))).status).toBe(503);
  expect((await (await GET(request(cookie))).json()).plan).toBeNull();
});

async function reviewFixture() {
  vi.stubEnv("JUPITER_API_KEY", "nonsecret-test-key");
  const user = await login(),
    store = agentStore(),
    now = Date.now();
  const plan = await store.create(user.wallet, start.settings, now - 30000);
  const decision: AgentDecision = {
    id: randomUUID(),
    planId: plan.id,
    sourceId: "1",
    sourceSignature: null,
    sourceAt: now - 20000,
    observedAt: now - 10000,
    expiresAt: now + 100000,
    marketId: "market",
    eventId: "event",
    title: "Synthetic event",
    side: "yes",
    action: "buy",
    leaderPrice: "600000",
    leaderContracts: "20000000",
    quotePrice: "610000",
    quoteAt: now - 10000,
    allocation: "10000000",
    status: "review",
    reason: "Synthetic proposal",
  };
  const token = (await store.acquire(plan))!;
  await store.commit(plan, token, plan, [decision]);
  await store.release(plan.id, token);
  const input = { planId: plan.id, decisionId: decision.id };
  const data = (path: string) =>
    path.startsWith("/positions?")
      ? { data: [], pagination: { end: 0, total: 0, hasNext: false } }
      : path.startsWith("/markets/")
        ? {
            marketId: "market",
            eventId: "event",
            title: "Synthetic event",
            provider: "polymarket",
            status: "open",
            result: null,
            closeTime: now / 1000 + 3600,
            pricing: { buyYesPriceUsd: "610000", buyNoPriceUsd: "400000" },
          }
        : path.startsWith("/orderbook/")
          ? { yes_dollars: [["0.60", "20"]], no_dollars: [["0.01", "1000"]] }
          : { trading_active: true };
  return { user, store, plan, decision, input, data };
}
it("requires private proposal ownership, same origin and strict read-only inputs", async () => {
  const f = await reviewFixture();
  expect((await REVIEW(request("", f.input))).status).toBe(401);
  expect((await REVIEW(request((await login()).cookie, f.input))).status).toBe(
    409,
  );
  expect(
    (await REVIEW(request(f.user.cookie, f.input, "https://other.example")))
      .status,
  ).toBe(403);
  expect(
    (await REVIEW(request(f.user.cookie, { ...f.input, execute: true })))
      .status,
  ).toBe(422);
});
it("saves private size-aware evidence without signing, provider writes or proposal status changes", async () => {
  const f = await reviewFixture();
  vi.stubEnv("ENABLE_LIVE_EXECUTION", "true");
  const provider = vi
    .spyOn(JupiterProvider.prototype, "request")
    .mockImplementation(async (path) => f.data(path));
  const response = await REVIEW(request(f.user.cookie, f.input));
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.execution).toBe("disabled");
  expect(result.entry.status).toBe("within_limit");
  expect(result.exit.coverageBps).toBe("10000");
  expect(result.exit.estimate.net).toBeNull();
  expect(provider.mock.calls).toHaveLength(4);
  expect(provider.mock.calls.every((call) => call.length === 1)).toBe(true);
  expect((await f.store.decisions(f.plan.id))[0].status).toBe("review");
  expect(result.wallet.status).toBe("unknown");
  expect(result.wallet.exposure.positionCount).toBe(0);
  expect(await f.store.journal(f.user.wallet)).toHaveLength(1);
  expect(
    (await (await GET(request(f.user.cookie))).json()).journal[0].outcome,
  ).toBe("not_executed");
  expect(
    (await (await GET(request((await login()).cookie))).json()).journal,
  ).toEqual([]);
});
it("rejects a dismissed proposal or paused plan even when the change occurs during provider reads", async () => {
  const f = await reviewFixture();
  vi.spyOn(JupiterProvider.prototype, "request").mockImplementation(
    async (path) => {
      if (path.startsWith("/markets/"))
        await f.store.change(f.user.wallet, "pause");
      return f.data(path);
    },
  );
  expect((await REVIEW(request(f.user.cookie, f.input))).status).toBe(409);
  expect((await f.store.get(f.user.wallet))?.status).toBe("paused");
  expect(await f.store.journal(f.user.wallet)).toEqual([]);
  await f.store.change(f.user.wallet, "resume");
  expect((await REVIEW(request(f.user.cookie, f.input))).status).toBe(409);
});
it("records a blocked wallet review without reserving funds or claiming execution", async () => {
  const f = await reviewFixture();
  vi.spyOn(walletReads, "readWalletFunds").mockResolvedValue({
    at: Date.now(),
    balances: { USDC: "1", JupUSD: "100000000" },
    solLamports: "1000000",
  });
  vi.spyOn(JupiterProvider.prototype, "request").mockImplementation(
    async (path) => f.data(path),
  );
  const response = await REVIEW(request(f.user.cookie, f.input)),
    report = await response.json();
  expect(report.wallet.status).toBe("blocked");
  expect(report.wallet.selectedAsset).toBe("USDC");
  expect(report.execution).toBe("disabled");
  expect((await f.store.journal(f.user.wallet))[0].outcome).toBe(
    "not_executed",
  );
  expect((await f.store.reservations(f.plan.id)).total).toBe(10000000n);
});

it("carries a new source fill through saved plan, collector, review, pause, resume and wallet isolation", async () => {
  vi.stubEnv("AGENT_COLLECTOR_ENABLED", "true");
  vi.stubEnv("JUPITER_API_KEY", "nonsecret-test-key");
  let clock = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  const user = await login(),
    other = await login();
  const oldFill = {
    id: "1",
    ownerPubkey: trader,
    eventType: "order_filled",
    timestamp: Math.floor(clock / 1000) - 60,
    marketId: "flow-market",
    eventId: "flow-event",
    isBuy: true,
    isYes: true,
    filledContractsMicro: "20000000",
    avgFillPriceUsd: "500000",
    signature: null,
    eventMetadata: { title: "Synthetic complete-flow event" },
  };
  let history = [oldFill];
  vi.spyOn(walletReads, "readWalletFunds").mockImplementation(async () => ({
    at: clock,
    balances: { USDC: "100000000", JupUSD: "0" },
    solLamports: "1000000",
  }));
  const provider = vi
    .spyOn(JupiterProvider.prototype, "request")
    .mockImplementation(async (path) => {
      if (path.startsWith("/history?"))
        return {
          data: history,
          pagination: { end: history.length, hasNext: false },
        };
      if (path.startsWith("/markets/"))
        return {
          marketId: "flow-market",
          eventId: "flow-event",
          title: "Synthetic complete-flow event",
          provider: "polymarket",
          status: "open",
          result: null,
          closeTime: clock / 1000 + 3600,
          pricing: { buyYesPriceUsd: "500000", buyNoPriceUsd: "500000" },
        };
      if (path.startsWith("/orderbook/"))
        return {
          yes_dollars: [["0.49", "100"]],
          no_dollars: [["0.49", "100"]],
        };
      if (path.startsWith("/positions?"))
        return { data: [], pagination: { end: 0, total: 0, hasNext: false } };
      if (path === "/trading-status") return { trading_active: true };
      throw Error("Unexpected provider path: " + path);
    });
  const started = await POST(request(user.cookie, start));
  expect(started.status).toBe(200);
  const initial = await started.json();
  expect(initial.plan.cursor.id).toBe("1");
  expect(initial.decisions).toEqual([]); // Historical fills must not be copied.
  clock += 16000;
  history = [
    { ...oldFill, id: "2", timestamp: Math.floor(clock / 1000) - 1 },
    oldFill,
  ];
  const refresh = await POST(
    request(user.cookie, { action: "refresh", planId: initial.plan.id }),
  );
  expect(refresh.status).toBe(200);
  const collected = await refresh.json();
  expect(collected.decisions).toHaveLength(1);
  const proposal = collected.decisions[0];
  expect(proposal.status).toBe("review");
  expect(proposal.sourceId).toBe("2");
  expect(collected.reserved).toBe("10000000");
  const reviewInput = { planId: initial.plan.id, decisionId: proposal.id };
  const reviewed = await REVIEW(request(user.cookie, reviewInput));
  expect(reviewed.status).toBe(200);
  const report = await reviewed.json();
  expect(report.wallet.status).toBe("within_budget");
  expect(report.exit.status).toBe("covered");
  const reloaded = await (await GET(request(user.cookie))).json();
  expect(reloaded.plan.id).toBe(initial.plan.id);
  expect(reloaded.journal[0].decision.sourceId).toBe("2");
  expect(reloaded.journal[0].outcome).toBe("not_executed");
  expect(reloaded.monitoring.fills).toBe(1);
  expect(reloaded.execution).toBe("disabled");
  expect((await REVIEW(request(other.cookie, reviewInput))).status).toBe(409);
  expect((await (await GET(request(other.cookie))).json()).journal).toEqual([]);
  expect(
    (
      await POST(
        request(user.cookie, { action: "pause", planId: initial.plan.id }),
      )
    ).status,
  ).toBe(200);
  expect((await REVIEW(request(user.cookie, reviewInput))).status).toBe(409);
  expect(
    (
      await POST(
        request(user.cookie, { action: "resume", planId: initial.plan.id }),
      )
    ).status,
  ).toBe(200);
  expect((await REVIEW(request(user.cookie, reviewInput))).status).toBe(409);
  expect((await (await GET(request(user.cookie))).json()).journal).toHaveLength(
    1,
  );
  expect(provider.mock.calls.every((call) => call.length === 1)).toBe(true); // No provider writes.
});
