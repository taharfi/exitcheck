import type { AgentDecision, AgentPlan } from "./agent-model";

export type AgentPoll = {
  startedAt: number;
  at: number;
  kind: "baseline" | "overlap" | "failure" | "gap";
  pages: number | null;
  errorCode: string | null;
};

export type AgentMonitoringReport = {
  planId: string;
  calculatedAt: number;
  recordingStartedAt: number | null;
  latestRecordedAt: number | null;
  polls: number;
  olderPollsWithoutRecords: number;
  baselines: number;
  overlapChecks: number;
  failedChecks: number;
  continuityFailures: number;
  continuity:
    "not_started" | "baseline_only" | "overlap_observed" | "interrupted";
  fills: number;
  buys: number;
  sells: number;
  proposed: number;
  skipped: number;
  exitSignals: number;
  delay: {
    samples: number;
    excluded: number;
    averageMs: number | null;
    maximumMs: number | null;
  };
  drift: {
    samples: number;
    unquotedBuys: number;
    averageBps: string | null;
    maximumBps: string | null;
  };
  skipReasons: { reason: string; count: number }[];
};

// Use immutable decision bodies: later dismissal/expiry is not an original skip.
// These are provider observations, never a measure of captured/total chain trades.
export function summarizeAgentMonitoring(
  plan: AgentPlan,
  decisions: Iterable<AgentDecision>,
  polls: Iterable<AgentPoll>,
  now = Date.now(),
): AgentMonitoringReport {
  const report: AgentMonitoringReport = {
    planId: plan.id,
    calculatedAt: now,
    recordingStartedAt: null,
    latestRecordedAt: null,
    polls: 0,
    olderPollsWithoutRecords: 0,
    baselines: 0,
    overlapChecks: 0,
    failedChecks: 0,
    continuityFailures: 0,
    continuity: "not_started",
    fills: 0,
    buys: 0,
    sells: 0,
    proposed: 0,
    skipped: 0,
    exitSignals: 0,
    delay: { samples: 0, excluded: 0, averageMs: null, maximumMs: null },
    drift: { samples: 0, unquotedBuys: 0, averageBps: null, maximumBps: null },
    skipReasons: [],
  };
  let latest: AgentPoll | null = null;
  for (const poll of polls) {
    report.polls++;
    report.recordingStartedAt = Math.min(
      report.recordingStartedAt ?? poll.startedAt,
      poll.startedAt,
    );
    report.latestRecordedAt = Math.max(
      report.latestRecordedAt ?? poll.at,
      poll.at,
    );
    if (!latest || poll.at >= latest.at) latest = poll;
    if (poll.kind === "baseline") report.baselines++;
    if (poll.kind === "overlap") report.overlapChecks++;
    if (poll.kind === "failure" || poll.kind === "gap") report.failedChecks++;
    if (poll.kind === "gap") report.continuityFailures++;
  }
  report.olderPollsWithoutRecords = Math.max(0, plan.polls - report.polls);
  report.continuity =
    plan.error ||
    plan.status !== "watching" ||
    plan.expiresAt <= now ||
    (latest && (latest.kind === "gap" || latest.kind === "failure"))
      ? "interrupted"
      : !plan.cursor
        ? "not_started"
        : latest?.kind === "baseline"
          ? "baseline_only"
          : report.overlapChecks
            ? "overlap_observed"
            : report.baselines
              ? "baseline_only"
              : "not_started";
  const reasons = new Map<string, number>();
  let delayTotal = 0n,
    driftTotal = 0n,
    maxDrift: bigint | null = null;
  for (const decision of decisions) {
    report.fills++;
    if (decision.action === "buy") report.buys++;
    else report.sells++;
    if (decision.status === "review") report.proposed++;
    if (decision.status === "exit_signal") report.exitSignals++;
    if (decision.status === "skipped") {
      report.skipped++;
      reasons.set(decision.reason, (reasons.get(decision.reason) ?? 0) + 1);
    }
    const delay = decision.observedAt - decision.sourceAt;
    if (
      Number.isSafeInteger(delay) &&
      delay >= 0 &&
      decision.observedAt <= now &&
      decision.sourceAt > plan.createdAt
    ) {
      report.delay.samples++;
      delayTotal += BigInt(delay);
      report.delay.maximumMs = Math.max(report.delay.maximumMs ?? delay, delay);
    } else report.delay.excluded++;
    if (decision.action !== "buy") continue;
    if (
      decision.quotePrice &&
      /^\d+$/.test(decision.quotePrice) &&
      /^\d+$/.test(decision.leaderPrice) &&
      decision.quoteAt !== null &&
      decision.quoteAt <= decision.observedAt &&
      decision.observedAt - decision.quoteAt <= 20000 &&
      BigInt(decision.leaderPrice) > 0n &&
      BigInt(decision.leaderPrice) < 1000000n &&
      BigInt(decision.quotePrice) > 0n &&
      BigInt(decision.quotePrice) < 1000000n
    ) {
      const drift =
        ((BigInt(decision.quotePrice) - BigInt(decision.leaderPrice)) *
          10000n) /
        BigInt(decision.leaderPrice);
      report.drift.samples++;
      driftTotal += drift;
      maxDrift = maxDrift === null || drift > maxDrift ? drift : maxDrift;
    } else report.drift.unquotedBuys++;
  }
  if (report.delay.samples)
    report.delay.averageMs = Number(delayTotal / BigInt(report.delay.samples));
  if (report.drift.samples) {
    report.drift.averageBps = (
      driftTotal / BigInt(report.drift.samples)
    ).toString();
    report.drift.maximumBps = maxDrift!.toString();
  }
  report.skipReasons = [...reasons]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  return report;
}
