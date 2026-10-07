import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { AgentStore } from "../../src/features/copy-trading/agent-store";
import { evaluateAgentEntry } from "../../src/features/copy-trading/agent-review";
import type { AgentDecision } from "../../src/features/copy-trading/agent-model";
const wallet = "11111111111111111111111111111111",
  other = "DVHD66wYT5wFcgJ9K2SbtJTmbsJxzz6chkAzNwzbksdT";
async function prepare(store: AgentStore) {
  const now = Date.now(),
    plan = await store.create(wallet, {
      trader: other,
      budget: "100",
      entry: "10",
    });
  const d: AgentDecision = {
    id: randomUUID(),
    planId: plan.id,
    sourceId: "source",
    sourceSignature: null,
    sourceAt: now,
    observedAt: now,
    expiresAt: now + 120000,
    marketId: "market",
    eventId: "event",
    title: "Synthetic event",
    side: "yes",
    action: "buy",
    leaderPrice: "500000",
    leaderContracts: "10000000",
    quotePrice: null,
    quoteAt: null,
    allocation: "10000000",
    status: "review",
    reason: "Synthetic proposal",
  };
  const token = (await store.acquire(plan))!;
  await store.commit(plan, token, plan, [d]);
  await store.release(plan.id, token);
  return { plan, d, r: evaluateAgentEntry(d, null, null, null, now) };
}
it("persists private historical snapshots across restart, dismissal, stop and replacement", async () => {
  const path = join(tmpdir(), "exitcheck-journal-" + randomUUID() + ".sqlite");
  let store = new AgentStore(path);
  try {
    const { plan, d, r } = await prepare(store),
      record = await store.saveReview(wallet, plan.id, d, r);
    await store.dismiss(wallet, d.id);
    await store.change(wallet, "stop");
    store.db.close();
    store = new AgentStore(path);
    expect((await store.journal(wallet))[0]).toEqual(record);
    expect(await store.journal(other)).toEqual([]);
    expect((await store.journal(wallet))[0].decision.status).toBe("review");
    expect((await store.journal(wallet))[0].outcome).toBe("not_executed");
    await prepare(store);
    expect(await store.journal(wallet)).toHaveLength(1);
  } finally {
    store.db.close();
    rmSync(path, { force: true });
  }
});
it("refuses journals for a foreign wallet, mismatched decision, paused plan or expired proposal", async () => {
  const store = new AgentStore(":memory:");
  try {
    const { plan, d, r } = await prepare(store);
    await expect(store.saveReview(other, plan.id, d, r)).rejects.toThrow();
    await expect(
      store.saveReview(wallet, plan.id, d, { ...r, decisionId: randomUUID() }),
    ).rejects.toThrow();
    await expect(
      store.saveReview(wallet, plan.id, d, r, d.expiresAt + 1),
    ).rejects.toThrow();
    await store.change(wallet, "pause");
    await expect(store.saveReview(wallet, plan.id, d, r)).rejects.toThrow();
    expect(await store.journal(wallet)).toEqual([]);
  } finally {
    store.db.close();
  }
});
