import { agentStore } from "@/features/copy-trading/agent-store";
import { collectAgentPlan } from "@/features/copy-trading/agent-collector";
import { shadowStore } from "@/features/copy-trading/shadow-store";
import { collectShadow } from "@/features/copy-trading/shadow-collector";
import { collectMarkets } from "@/features/prediction-bot/market-recorder";
import { JupiterProvider } from "@/lib/provider/jupiter";

const schema =
  "CREATE TABLE IF NOT EXISTS monitoring_runner(id INTEGER PRIMARY KEY CHECK(id=1),token TEXT NOT NULL,generation TEXT NOT NULL,until INTEGER NOT NULL,last_markets INTEGER NOT NULL DEFAULT 0,owner_run TEXT)";
function database() {
  const db = agentStore().db;
  db.initialize(schema);
  return db;
}

export async function claimMonitoring(
  token: string,
  generation: string,
  now = Date.now(),
) {
  const result = await database()
    .prepare(
      "INSERT INTO monitoring_runner(id,token,generation,until) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,generation=excluded.generation,until=excluded.until,owner_run=NULL WHERE monitoring_runner.until<? OR monitoring_runner.generation<>?",
    )
    .run(token, generation, now + 300000, now, generation);
  return result.changes === 1;
}
export async function releaseMonitoring(token: string) {
  await database()
    .prepare("DELETE FROM monitoring_runner WHERE token=?")
    .run(token);
}
export async function releaseRunOwnership(token: string, run: string) {
  const result = await database()
    .prepare(
      "UPDATE monitoring_runner SET owner_run=NULL WHERE token=? AND owner_run=?",
    )
    .run(token, run);
  return result.changes === 1;
}
export async function runMonitoringTick(token: string, run: string) {
  if (process.env.MONITORING_WORKFLOW_ENABLED !== "true") {
    await releaseMonitoring(token);
    return false;
  }
  const db = database(),
    now = Date.now();
  const renewed = await db
    .prepare(
      "UPDATE monitoring_runner SET until=?,owner_run=? WHERE id=1 AND token=? AND (owner_run IS NULL OR owner_run=?)",
    )
    .run(now + 300000, run, token, run);
  if (renewed.changes !== 1) return false;
  const provider = new JupiterProvider();
  if (process.env.AGENT_COLLECTOR_ENABLED === "true") {
    const store = agentStore();
    for (const plan of await store.active()) {
      if (plan.lastPoll !== null && Date.now() - plan.lastPoll < 15000)
        continue;
      await collectAgentPlan(store, plan, (path) => provider.request(path));
    }
  }
  if (process.env.SHADOW_COLLECTOR_ENABLED === "true")
    await collectShadow(shadowStore(), (path) => provider.request(path));
  if (process.env.MARKET_RECORDER_ENABLED === "true") {
    const due = await db
      .prepare(
        "UPDATE monitoring_runner SET last_markets=? WHERE token=? AND last_markets<?",
      )
      .run(Date.now(), token, Date.now() - 60000);
    if (due.changes === 1) await collectMarkets();
  }
  await db
    .prepare("UPDATE monitoring_runner SET until=? WHERE token=?")
    .run(Date.now() + 300000, token);
  return true;
}
