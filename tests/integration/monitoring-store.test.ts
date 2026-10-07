import { afterAll, afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { agentStore } from "../../src/features/copy-trading/agent-store";
import {
  claimMonitoring,
  releaseMonitoring,
  releaseRunOwnership,
  runMonitoringTick,
} from "../../src/lib/server/monitoring";

process.env.SHADOW_DB_PATH = `./test-results/monitoring-${randomUUID()}.sqlite`;
afterEach(() => vi.unstubAllEnvs());
afterAll(() => agentStore().db.close());
it("owns one run, hands off once, and stops an older deployment from polling", async () => {
  vi.stubEnv("MONITORING_WORKFLOW_ENABLED", "true");
  vi.stubEnv("AGENT_COLLECTOR_ENABLED", "false");
  vi.stubEnv("SHADOW_COLLECTOR_ENABLED", "false");
  vi.stubEnv("MARKET_RECORDER_ENABLED", "false");
  expect(await claimMonitoring("first-token", "deployment-1")).toBe(true);
  expect(await claimMonitoring("duplicate-token", "deployment-1")).toBe(false);
  expect(await runMonitoringTick("first-token", "first-run")).toBe(true);
  expect(await runMonitoringTick("first-token", "duplicate-run")).toBe(false);
  expect(await releaseRunOwnership("first-token", "wrong-run")).toBe(false);
  expect(await releaseRunOwnership("first-token", "first-run")).toBe(true);
  expect(await releaseRunOwnership("first-token", "first-run")).toBe(false);
  expect(await runMonitoringTick("first-token", "next-run")).toBe(true);
  expect(await runMonitoringTick("first-token", "duplicate-next-run")).toBe(
    false,
  );
  expect(await claimMonitoring("new-token", "deployment-2")).toBe(true);
  expect(await runMonitoringTick("first-token", "next-run")).toBe(false);
  expect(await runMonitoringTick("new-token", "new-run")).toBe(true);
  await releaseMonitoring("first-token");
  expect(await runMonitoringTick("new-token", "new-run")).toBe(true);
  vi.stubEnv("MONITORING_WORKFLOW_ENABLED", "false");
  expect(await runMonitoringTick("new-token", "new-run")).toBe(false);
});
