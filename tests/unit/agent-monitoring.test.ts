import { afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { AgentStore } from "../../src/features/copy-trading/agent-store";
import {
  summarizeAgentMonitoring,
  type AgentPoll,
} from "../../src/features/copy-trading/agent-monitoring";
import type { AgentDecision } from "../../src/features/copy-trading/agent-model";
import { collectAgentPlan } from "../../src/features/copy-trading/agent-collector";
import { AppError } from "../../src/lib/errors";

const wallet = "11111111111111111111111111111111",
  trader = "DVHD66wYT5wFcgJ9K2SbtJTmbsJxzz6chkAzNwzbksdT",
  now = 1700000000000;
const stores: AgentStore[] = [];
async function setup() {
  const store = new AgentStore(":memory:");
  stores.push(store);
  return {
    store,
    plan: await store.create(
      wallet,
      { trader, budget: "100", entry: "10" },
      now - 10000,
    ),
  };
}
afterEach(() => {
  for (const s of stores.splice(0)) s.db.close();
});
function decision(
  planId: string,
  patch: Partial<AgentDecision> = {},
): AgentDecision {
  return {
    id: randomUUID(),
    planId,
    sourceId: randomUUID(),
    sourceSignature: null,
    sourceAt: now - 5000,
    observedAt: now,
    expiresAt: now + 120000,
    marketId: "m",
    eventId: "e",
    title: "Synthetic event",
    side: "yes",
    action: "buy",
    leaderPrice: "500000",
    leaderContracts: "10000000",
    quotePrice: "510000",
    quoteAt: now,
    allocation: "10000000",
    status: "review",
    reason: "Synthetic proposal",
    ...patch,
  };
}
const poll = (kind: AgentPoll["kind"], at = now): AgentPoll => ({
  startedAt: at - 100,
  at,
  kind,
  pages: kind === "gap" || kind === "failure" ? null : 1,
  errorCode: kind === "gap" ? "HISTORY_GAP" : null,
});

it("keeps empty measurements unknown and distinguishes an initial baseline from observed fills", async () => {
  const { plan } = await setup();
  const report = summarizeAgentMonitoring(
    { ...plan, polls: 1, cursor: { id: "0", fingerprint: "empty" } },
    [],
    [poll("baseline")],
    now,
  );
  expect(report).toMatchObject({
    fills: 0,
    baselines: 1,
    overlapChecks: 0,
    continuity: "baseline_only",
    olderPollsWithoutRecords: 0,
  });
  expect(report.delay.averageMs).toBeNull();
  expect(report.drift.averageBps).toBeNull();
  expect(
    summarizeAgentMonitoring(plan, [], [], now).recordingStartedAt,
  ).toBeNull();
});

it("reports signed quote drift with its own denominator and excludes missing/stale quotes and future timestamps", async () => {
  const { plan } = await setup();
  const rows = [
    decision(plan.id),
    decision(plan.id, {
      quotePrice: "490000",
      observedAt: now - 1000,
      quoteAt: now - 1000,
    }),
    decision(plan.id, {
      quotePrice: null,
      quoteAt: null,
      status: "skipped",
      reason: "Missing quote",
    }),
    decision(plan.id, {
      quoteAt: now - 20001,
      status: "skipped",
      reason: "Missing quote",
    }),
    decision(plan.id, {
      action: "sell",
      status: "exit_signal",
      sourceAt: now + 1000,
    }),
  ];
  const report = summarizeAgentMonitoring(plan, rows, [], now);
  expect(report).toMatchObject({
    fills: 5,
    buys: 4,
    sells: 1,
    proposed: 2,
    skipped: 2,
    exitSignals: 1,
  });
  expect(report.delay).toEqual({
    samples: 4,
    excluded: 1,
    averageMs: 4750,
    maximumMs: 5000,
  });
  expect(report.drift).toEqual({
    samples: 2,
    unquotedBuys: 2,
    averageBps: "0",
    maximumBps: "200",
  });
  expect(report.skipReasons).toEqual([{ reason: "Missing quote", count: 2 }]);
});

it("preserves past failures after recovery without claiming continuous uptime, and labels unrecorded older polls", async () => {
  const { plan } = await setup();
  const observed = { ...plan, polls: 7, cursor: { id: "1", fingerprint: "f" } };
  const records = [
    poll("baseline", now - 3000),
    poll("overlap", now - 2000),
    poll("gap", now - 1000),
    poll("baseline"),
  ];
  const report = summarizeAgentMonitoring(observed, [], records, now);
  expect(report).toMatchObject({
    polls: 4,
    olderPollsWithoutRecords: 3,
    failedChecks: 1,
    continuityFailures: 1,
    continuity: "baseline_only",
    recordingStartedAt: now - 3100,
    latestRecordedAt: now,
  });
  expect(
    summarizeAgentMonitoring({ ...observed, cursor: null }, [], records, now)
      .continuity,
  ).toBe("not_started");
  expect(
    summarizeAgentMonitoring(
      { ...observed, status: "paused" },
      [],
      records,
      now,
    ).continuity,
  ).toBe("interrupted");
});

it("counts all saved decisions, retains original proposal outcomes after dismissal and persists privately across restart", async () => {
  const path = join(
    tmpdir(),
    "exitcheck-monitoring-" + randomUUID() + ".sqlite",
  );
  let store = new AgentStore(path);
  try {
    const plan = await store.create(
      wallet,
      { trader, budget: "100", entry: "10" },
      now - 10000,
    );
    const rows = Array.from({ length: 205 }, () => decision(plan.id));
    const token = (await store.acquire(plan, now))!;
    expect(
      await store.commit(
        plan,
        token,
        { ...plan, polls: 1, cursor: { id: "1", fingerprint: "f" } },
        rows,
        now,
        poll("overlap"),
      ),
    ).toBe(true);
    await store.release(plan.id, token);
    await store.dismiss(wallet, rows[0].id);
    expect(await store.decisions(plan.id, now)).toHaveLength(200);
    expect(await store.monitoring(wallet, now)).toMatchObject({
      fills: 205,
      proposed: 205,
      skipped: 0,
      overlapChecks: 1,
    });
    expect(await store.monitoring(trader, now)).toBeNull();
    store.db.close();
    store = new AgentStore(path);
    expect(await store.monitoring(wallet, now)).toMatchObject({
      fills: 205,
      proposed: 205,
      polls: 1,
    });
    await store.change(wallet, "stop", now);
    expect((await store.monitoring(wallet, now))?.fills).toBe(205);
    await store.create(
      wallet,
      { trader, budget: "100", entry: "10" },
      now + 1000,
    );
    expect((await store.monitoring(wallet, now + 1000))?.fills).toBe(0);
  } finally {
    store.db.close();
    rmSync(path, { force: true });
  }
});

it("records real collector baseline, provider failure, overlap and gap outcomes atomically", async () => {
  const { store, plan } = await setup();
  const header = {
    id: "1",
    ownerPubkey: trader,
    eventType: "test",
    timestamp: now / 1000,
  };
  const page = { data: [header], pagination: { end: 1, hasNext: false } };
  await collectAgentPlan(
    store,
    plan,
    async () => page,
    () => now,
  );
  expect((await store.monitoring(wallet, now))?.baselines).toBe(1);
  await collectAgentPlan(
    store,
    (await store.get(wallet))!,
    async () => {
      throw new AppError("PROVIDER_UNAVAILABLE", "Synthetic outage", 503);
    },
    () => now + 1000,
  );
  expect(await store.monitoring(wallet, now + 1000)).toMatchObject({
    failedChecks: 1,
    continuityFailures: 0,
    continuity: "interrupted",
  });
  await collectAgentPlan(
    store,
    (await store.get(wallet))!,
    async () => page,
    () => now + 2000,
  );
  expect(await store.monitoring(wallet, now + 2000)).toMatchObject({
    overlapChecks: 1,
    continuity: "overlap_observed",
  });
  await collectAgentPlan(
    store,
    (await store.get(wallet))!,
    async () => ({ ...page, data: [] }),
    () => now + 3000,
  );
  expect(await store.monitoring(wallet, now + 3000)).toMatchObject({
    polls: 4,
    failedChecks: 2,
    continuityFailures: 1,
    continuity: "interrupted",
  });
});

it("does not record a stale in-flight poll after the user pauses", async () => {
  const { store, plan } = await setup();
  const token = (await store.acquire(plan, now))!;
  await store.change(wallet, "pause", now);
  expect(
    await store.commit(
      plan,
      token,
      { ...plan, polls: 1 },
      [decision(plan.id)],
      now,
      poll("overlap"),
    ),
  ).toBe(false);
  expect(await store.monitoring(wallet, now)).toMatchObject({
    polls: 0,
    fills: 0,
  });
});
