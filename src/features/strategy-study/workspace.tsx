"use client";
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { AccountConnection } from "@/features/account/components/account-connection";
import type { replay, mockExecutionCase } from "./study";
import styles from "@/features/experiments/workspace.module.css";
type Result = {
  study: ReturnType<typeof replay>;
  feeds: {
    source: string;
    at: number;
    error: string | null;
    markets: number;
  }[];
  mock: ReturnType<typeof mockExecutionCase>;
};
export function StrategyStudy() {
  const [data, setData] = useState<Result | null>(null),
    [budget, setBudget] = useState(300),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    async (collect = false) => {
      setBusy(true);
      setError("");
      try {
        const r = await fetch(
          "/api/strategy-study?budget=" + budget,
          collect
            ? {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ budget }),
              }
            : {},
        );
        const j = await r.json();
        if (!r.ok) throw Error(j.error?.message ?? "Study unavailable.");
        setData(j);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Study unavailable.");
      } finally {
        setBusy(false);
      }
    },
    [budget],
  );
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  return (
    <>
      <AppHeader actions={<AccountConnection />} />
      <main className={styles.main}>
        <p className={styles.eyebrow}>STRATEGY STUDY / SOLANA</p>
        <h1>Record first. Test second.</h1>
        <p>
          Real Jupiter observations, fixed hypotheses and a cash benchmark.
          Nothing here executes a trade.
        </p>
        <section className={styles.card}>
          <label htmlFor="budget">Paper budget per strategy ($)</label>
          <input
            id="budget"
            type="number"
            min={30}
            max={10000}
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
          />
          <button disabled={busy} onClick={() => void load()}>
            Replay recorded data
          </button>{" "}
          <button disabled={busy} onClick={() => void load(true)}>
            Record live observation
          </button>
          <p>
            Sign in to collect. Four fixed markets maximum; data is shared
            public market data, never wallet holdings. At least one minute
            between observations. No automatic collection unless the local
            collector is running.
          </p>
        </section>
        {error && <p role="alert">{error}</p>}
        {data && (
          <>
            <section className={styles.card}>
              <h2>{data.study.observations} recorded observations</h2>
              <p>
                {data.study.verifiedObservations} identity-verified /{" "}
                {data.study.depthObservations} with recorded Solana exit depth
              </p>
              {data.study.latestCohort.map((m) => (
                <p key={m.id}>
                  {m.id}: {m.status} / Resolution:{" "}
                  {m.resolvedResult ?? "Unknown"} /{" "}
                  {m.verified ? "Identity verified" : m.reason} /{" "}
                  {m.depth
                    ? "Exit bids recorded"
                    : (m.depthError ?? "No recorded depth")}
                </p>
              ))}
              <p>{data.study.notice}</p>
              <p>
                Fixed triggers: +/-3 percentage points within 90 seconds.
                Liquidity filter: spread at most 5 points and fresh bid capacity
                sufficient for the modeled position. Up to three positions; 20%
                initial budget per entry. Exit at +/-5 points or after one hour,
                only if recorded bids can cover the full position.
              </p>
              <p>
                70% development / 30% chronological evaluation. No training or
                optimization; short samples remain unqualified. Unknown outcomes
                are not settled.
              </p>
              {data.feeds.map((f) => (
                <p key={f.source}>
                  {f.source}: {f.markets} markets / {f.error ?? "Available"}
                </p>
              ))}
            </section>
            {(["development", "evaluation"] as const).map((part) => (
              <section className={styles.card} key={part}>
                <h2>
                  {part === "evaluation"
                    ? "Chronological evaluation segment"
                    : "Development segment"}
                </h2>
                <div className={styles.grid}>
                  {data.study[part].map((s) => (
                    <article key={s.name}>
                      <h3>{s.name}</h3>
                      <p>
                        Marked equity ${s.equity.toFixed(2)} / Cash $
                        {s.cash.toFixed(2)}
                      </p>
                      <p>
                        Realized model change ${s.realized.toFixed(2)} /
                        Drawdown ${s.drawdown.toFixed(2)}
                      </p>
                      <p>
                        {s.signals} signals / {s.blocked} blocked / {s.closed}{" "}
                        closed / {s.open} open
                      </p>
                      <details>
                        <summary>Decision log</summary>
                        {s.log.map((l, i) => (
                          <p key={i}>
                            {l.market}: {l.decision}
                          </p>
                        ))}
                      </details>
                    </article>
                  ))}
                </div>
              </section>
            ))}
            <section className={styles.card}>
              <h2>Execution sandbox: mock only</h2>
              <p>{data.mock.notice}</p>
              <p>
                {data.mock.steps.join(" / ")} / fills: {data.mock.fills}
              </p>
              <p>
                Jupiter prediction devnet support has not been verified. This
                checks control flow; it cannot validate keeper fills or
                profitability.
              </p>
            </section>
          </>
        )}
      </main>
    </>
  );
}
