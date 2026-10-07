import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { start } from "workflow/api";
import { monitorExitCheck } from "@/workflows/monitoring";
import { claimMonitoring, releaseMonitoring } from "@/lib/server/monitoring";

export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (
    !secret ||
    !timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`))
  )
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  if (process.env.MONITORING_WORKFLOW_ENABLED !== "true")
    return Response.json(
      { enabled: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  const token = randomUUID();
  const claimed = await claimMonitoring(
    token,
    process.env.VERCEL_DEPLOYMENT_ID ?? "local",
  );
  if (!claimed)
    return Response.json(
      { running: true, started: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  try {
    const run = await start(monitorExitCheck, [token]);
    return Response.json(
      { running: true, started: true, runId: run.runId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    await releaseMonitoring(token);
    return Response.json(
      { error: "Monitoring could not start" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
