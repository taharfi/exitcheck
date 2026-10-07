import { getWorkflowMetadata, sleep } from "workflow";
import { start } from "workflow/api";

export async function monitorExitCheck(token: string) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  // Rotate before event logs grow large. Each continuation claims exclusive
  // run ownership, so a retried launch cannot create duplicate poll loops.
  for (let tick = 0; tick < 200; tick++) {
    if (!(await monitoringTick(token, workflowRunId))) return;
    await sleep("60s");
  }
  if (await handoffMonitoring(token, workflowRunId))
    await start(monitorExitCheck, [token]);
}

async function monitoringTick(token: string, run: string) {
  "use step";
  const { runMonitoringTick } = await import("@/lib/server/monitoring");
  try {
    return await runMonitoringTick(token, run);
  } catch {
    console.error(JSON.stringify({ event: "monitoring_tick_failed" }));
    // Retry on the next scheduled tick. Existing plan leases and revisions
    // keep ambiguous prior writes from producing duplicate proposals.
    return true;
  }
}

async function handoffMonitoring(token: string, run: string) {
  "use step";
  const { releaseRunOwnership } = await import("@/lib/server/monitoring");
  return releaseRunOwnership(token, run);
}
