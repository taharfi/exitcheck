import nextEnv from "@next/env";
import { setTimeout } from "node:timers/promises";
import { writeFileSync } from "node:fs";
import { address } from "../../src/lib/provider/schemas";
import { JupiterProvider } from "../../src/lib/provider/jupiter";
import { AgentStore } from "../../src/features/copy-trading/agent-store";
import { collectAgentPlan } from "../../src/features/copy-trading/agent-collector";

nextEnv.loadEnvConfig(process.cwd());
const trader = address.parse(
  process.argv[2] ?? "DVHD66wYT5wFcgJ9K2SbtJTmbsJxzz6chkAzNwzbksdT",
);
const observer = "11111111111111111111111111111111";
const store = new AgentStore(":memory:"),
  provider = new JupiterProvider();
try {
  await store.create(observer, { trader, budget: "100", entry: "10" });
  for (let i = 0; i < 3; i++) {
    if (i) await setTimeout(15000);
    const plan = (await store.get(observer))!;
    if (plan.status !== "watching") break;
    await collectAgentPlan(store, plan, (path) => provider.request(path));
  }
  const report = (await store.monitoring(observer))!;
  const evidence = {
    capturedAt: new Date().toISOString(),
    readOnly: true,
    trader,
    isolatedInMemoryPlan: true,
    hypotheticalPlanningBudget: "100",
    hypotheticalEntry: "10",
    report,
    limitations:
      "Three bounded checks, 15 seconds apart, using provider history. This does not establish complete fill capture, continuous uptime, follower execution, profitability or user demand. Zero observed fills is not proof of inactivity.",
    ordersPrepared: 0,
    ordersSubmitted: 0,
  };
  writeFileSync(
    "docs/research/agent-monitoring-probe.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      readOnly: true,
      checks: report.polls,
      overlaps: report.overlapChecks,
      failures: report.failedChecks,
      fills: report.fills,
      ordersSubmitted: 0,
    }),
  );
  if (report.failedChecks || !report.overlapChecks) process.exitCode = 1;
} finally {
  store.db.close();
}
