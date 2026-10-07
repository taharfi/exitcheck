"use client";
import { useEffect, useRef, useState } from "react";
import { decimal, money } from "@/lib/amounts";
import type { AgentActivitySample } from "../agent-source";
import styles from "./agent.module.css";

export function TraderActivityPreview({ trader }: { trader: string }) {
  const [sample, setSample] = useState<AgentActivitySample | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const attempt = useRef<AbortController | null>(null);
  useEffect(() => () => attempt.current?.abort(), []);
  async function check() {
    if (attempt.current) return;
    const controller = new AbortController();
    attempt.current = controller;
    setBusy(true);
    setError("");
    setSample(null);
    try {
      const response = await fetch(
        "/api/agent/trader?" + new URLSearchParams({ trader }),
        {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(25000),
          ]),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw Error(data.error?.message ?? "Trader activity is unavailable.");
      if (data.trader !== trader)
        throw Error("Activity did not match the selected trader. Check again.");
      if (!controller.signal.aborted) setSample(data);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Trader activity is unavailable.",
        );
    } finally {
      if (!controller.signal.aborted) {
        attempt.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <section
      className={styles.traderPreview}
      aria-label="Trader activity preview"
    >
      <div className={styles.checkHeading}>
        <strong>Before you follow</strong>
        <button
          type="button"
          disabled={busy || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trader)}
          onClick={() => void check()}
        >
          {busy
            ? "Checking activity…"
            : sample
              ? "Refresh trader activity"
              : "Check trader activity"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {sample ? (
        <>
          <dl className={styles.checkFacts}>
            <div>
              <dt>Last sampled fill</dt>
              <dd>
                {sample.lastFillAt === null
                  ? "None in this sample"
                  : new Date(sample.lastFillAt).toLocaleString()}
              </dd>
            </div>
            <div>
              <dt>Buys / sells in sample</dt>
              <dd>
                {sample.buys} / {sample.sells}
              </dd>
            </div>
          </dl>
          {sample.recentFills.length ? (
            <details className={styles.source}>
              <summary>Recent filled trades</summary>
              <ul className={styles.recentFills}>
                {sample.recentFills.map((fill) => (
                  <li key={fill.id}>
                    <strong>
                      {fill.action === "buy" ? "Bought" : "Sold"}{" "}
                      {fill.side.toUpperCase()} · {fill.title}
                    </strong>
                    <span>
                      {decimal(fill.quantity, 4)} contracts at{" "}
                      {money(fill.price, 4)}
                    </span>
                    <time dateTime={new Date(fill.at).toISOString()}>
                      {new Date(fill.at).toLocaleString()}
                    </time>
                  </li>
                ))}
              </ul>
            </details>
          ) : (
            <p>
              No usable filled trades appeared in the sampled records. Older
              activity may exist.
            </p>
          )}
          <p className={styles.note}>
            {sample.sampledEvents} events sampled from one page.{" "}
            {sample.hasMoreEvents
              ? "More provider history exists."
              : "Provider reported no further pages."}
            {sample.excludedFills > 0
              ? ` ${sample.excludedFills} fills had unusable prices, quantities or timestamps and were excluded.`
              : ""}{" "}
            Read {new Date(sample.retrievedAt).toLocaleTimeString()}. Refreshes
            may reuse this reading for 30 seconds.
          </p>
        </>
      ) : (
        !error && (
          <p className={styles.note}>
            See recent filled trades before saving your plan. No wallet login is
            needed for this public check.
          </p>
        )
      )}
      <p className={styles.note}>
        Past trades are context, not copy proposals or proof of future
        performance. Watching starts from a new baseline.
      </p>
    </section>
  );
}
