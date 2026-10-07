import type { AgentMonitoringReport } from "../agent-monitoring";
import styles from "./agent.module.css";

const date = (value: number | null) =>
  value === null ? "Not recorded yet" : new Date(value).toLocaleString();
const seconds = (value: number | null) =>
  value === null ? "Not measured" : `${(value / 1000).toFixed(1)} seconds`;
const percent = (value: string | null) =>
  value === null
    ? "Not measured"
    : `${BigInt(value) > 0n ? "+" : ""}${(Number(value) / 100).toFixed(2)}%`;
const continuity = {
  not_started: "Waiting for a baseline",
  baseline_only: "Baseline established; no overlap check yet",
  overlap_observed: "Provider overlap observed",
  interrupted: "Observation interrupted",
};

export function AgentMonitoring({
  report,
  stale,
}: {
  report: AgentMonitoringReport;
  stale: boolean;
}) {
  return (
    <section className={styles.monitoring} aria-labelledby="monitoring-heading">
      <div className={styles.activityHeading}>
        <div>
          <p className="eyebrow">EVIDENCE BEFORE COPYING</p>
          <h2 id="monitoring-heading">Monitoring report</h2>
        </div>
        <span className={styles.state}>
          {report.fills
            ? "Limited observation evidence"
            : "No fills observed yet"}
        </span>
      </div>
      <p className={styles.reason}>
        {stale ? "Last successful source check is overdue. " : ""}
        {continuity[report.continuity]}. This report measures saved provider
        observations, not executed copies or profitability.
      </p>
      <dl className={styles.monitoringFacts}>
        <div>
          <dt>Saved fills in this plan</dt>
          <dd>{report.fills}</dd>
        </div>
        <div>
          <dt>Average detection delay</dt>
          <dd>{seconds(report.delay.averageMs)}</dd>
        </div>
        <div>
          <dt>Average indicative buy-price drift</dt>
          <dd>{percent(report.drift.averageBps)}</dd>
        </div>
        <div>
          <dt>History continuity failures</dt>
          <dd>{report.continuityFailures}</dd>
        </div>
      </dl>
      <p className={styles.reason}>
        Delay: {report.delay.samples} measured fills. Price drift:{" "}
        {report.drift.samples} quoted buys; {report.drift.unquotedBuys} without
        a usable quote. Positive drift means a higher price than the trader
        paid. Neither measure includes fees or an actual follower fill.
      </p>
      <details className={styles.limits}>
        <summary>Observation window, checks and skipped reasons</summary>
        <dl className={styles.monitoringFacts}>
          <div>
            <dt>Poll recording began</dt>
            <dd>{date(report.recordingStartedAt)}</dd>
          </div>
          <div>
            <dt>Latest recorded check</dt>
            <dd>{date(report.latestRecordedAt)}</dd>
          </div>
          <div>
            <dt>Recorded source checks</dt>
            <dd>{report.polls}</dd>
          </div>
          <div>
            <dt>Successful overlap checks</dt>
            <dd>{report.overlapChecks}</dd>
          </div>
          <div>
            <dt>Baselines established</dt>
            <dd>{report.baselines}</dd>
          </div>
          <div>
            <dt>Failed checks, including continuity failures</dt>
            <dd>{report.failedChecks}</dd>
          </div>
          <div>
            <dt>Longest measured detection delay</dt>
            <dd>{seconds(report.delay.maximumMs)}</dd>
          </div>
          <div>
            <dt>Highest measured buy-price drift</dt>
            <dd>{percent(report.drift.maximumBps)}</dd>
          </div>
          <div>
            <dt>Original entry proposals</dt>
            <dd>{report.proposed}</dd>
          </div>
          <div>
            <dt>Original skips / exit signals</dt>
            <dd>
              {report.skipped} / {report.exitSignals}
            </dd>
          </div>
        </dl>
        {report.olderPollsWithoutRecords > 0 && (
          <p className={styles.warning}>
            {report.olderPollsWithoutRecords} earlier source checks have no
            detailed poll record. Their success and continuity are unknown here.
          </p>
        )}
        {report.delay.excluded > 0 && (
          <p className={styles.reason}>
            {report.delay.excluded} fill timestamps excluded from delay
            measurements.
          </p>
        )}
        {report.skipReasons.length ? (
          <ul className={styles.skipReasons}>
            {report.skipReasons.map(({ reason, count }) => (
              <li key={reason}>
                <strong>{count}</strong>
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.reason}>No skipped fills recorded.</p>
        )}
        <p className={styles.reason}>
          The recorded span is not continuous uptime. Baselines omit past
          activity, and pauses, outages or provider omissions can leave unseen
          fills. All saved decisions in this plan are counted, including those
          outside the latest activity list. Dismissed or expired proposals
          remain original proposals in this report. Complete trade coverage and
          follower execution remain unverified.
        </p>
      </details>
    </section>
  );
}
