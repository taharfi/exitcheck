"use client";
import { AppHeader } from "@/components/app-header";
import { useState } from "react";
import { decimalToMicro, money } from "@/lib/amounts";
import type { replay } from "@/features/backtesting/backtest";
type Result = ReturnType<typeof replay> & { training: string; holdout: string };
type Report = {
  coverage: {
    owner: string;
    events: number;
    complete: boolean;
    stopReason: string;
  }[];
  from: number | null;
  to: number | null;
  cut: number | null;
  results: Result[];
  warning: string;
};
const usd = (s: string) =>
  s.startsWith("-") ? "-" + money(s.slice(1)) : money(s);
const defaults = [
  "E1Uc6BvyLS1cP47yuYq4sGQqbQPrrH6YKVuth88NzeHm",
  "782PjCvahP97LUL5KQ1rxzXWWExrcvMnemFxgn9LrfED",
  "DVHD66wYT5wFcgJ9K2SbtJTmbsJxzz6chkAzNwzbksdT",
];
export function BacktestWorkspace() {
  const [owners, setOwners] = useState(defaults),
    [budget, setBudget] = useState("100"),
    [fee, setFee] = useState("100"),
    [slippage, setSlippage] = useState("100"),
    [report, setReport] = useState<Report | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run() {
    setBusy(true);
    setError("");
    setReport(null);
    try {
      const q = new URLSearchParams({
        budget: decimalToMicro(budget).toString(),
        fee,
        slippage,
      });
      owners.forEach((x) => q.append("owner", x.trim()));
      const response = await fetch("/api/backtest?" + q, {
        signal: AbortSignal.timeout(180000),
        cache: "no-store",
      });
      const j = await response.json();
      if (!response.ok) throw Error(j.error?.message ?? "History unavailable.");
      setReport(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backtest failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <AppHeader />
      <main className="paper-main">
        <div className="paper-intro">
          <p className="eyebrow">STRATEGY LAB</p>
          <h1>
            Replay the past.
            <br />
            Question the result.
          </h1>
          <p>
            Compare allocation rules on real wallet histories, with explicit
            cost assumptions.
          </p>
        </div>
        <div className="paper-notice">
          <strong>Historical simulation - no trades submitted</strong>
          <p>
            We use recorded leader fills, not verified follower prices.
            Historical depth and copy latency are unavailable. Selecting
            today&apos;s successful wallets creates hindsight bias; these
            results cannot establish the best future strategy.
          </p>
        </div>
        <section className="paper-card">
          <h2>Choose your sample</h2>
          <p>
            Three example public wallets are prefilled. Replace them to compare
            other cohorts. We fetch up to three pages per wallet and flag
            truncated histories.
          </p>
          <div className="backtest-inputs">
            {owners.map((owner, i) => (
              <label key={i}>
                Wallet {i + 1}
                <input
                  value={owner}
                  aria-label={"Wallet " + (i + 1)}
                  onChange={(e) =>
                    setOwners((xs) =>
                      xs.map((x, j) => (j === i ? e.target.value : x)),
                    )
                  }
                />
              </label>
            ))}
          </div>
          <div className="backtest-settings">
            <label>
              Virtual starting budget ($)
              <input
                value={budget}
                inputMode="decimal"
                onChange={(e) => setBudget(e.target.value)}
              />
            </label>
            <label>
              Assumed fee per buy/sell (bps)
              <input
                value={fee}
                inputMode="numeric"
                onChange={(e) => setFee(e.target.value)}
              />
            </label>
            <label>
              Adverse price slippage (bps)
              <input
                value={slippage}
                inputMode="numeric"
                onChange={(e) => setSlippage(e.target.value)}
              />
            </label>
          </div>
          <p>
            100 bps = 1%. Fees are scenario assumptions, not Jupiter&apos;s
            actual follower fees. Network costs are excluded.
          </p>
          <button
            className="paper-primary"
            onClick={() => void run()}
            disabled={busy}
          >
            {busy
              ? "Loading history and replaying..."
              : "Compare three strategies"}
          </button>
          <p>
            Small entries: 5% per buy, 30% reserve, 10% event cap. Balanced: 10%
            per buy, 20% reserve, 20% event cap. Hold: balanced allocations,
            ignoring early sells. All use caller ceilings and a $5 minimum
            allocation.
          </p>
        </section>
        {error && (
          <p role="alert" className="paper-error">
            {error}
          </p>
        )}
        {report && (
          <>
            <section className="paper-card">
              <h2>Coverage comes first</h2>
              <p>
                {report.from !== null
                  ? new Date(report.from * 1000).toLocaleDateString()
                  : "No events"}{" "}
                to{" "}
                {report.to !== null
                  ? new Date(report.to * 1000).toLocaleDateString()
                  : "no events"}
              </p>
              {report.coverage.map((x) => (
                <p key={x.owner}>
                  {x.owner.slice(0, 6)}...{x.owner.slice(-5)} - {x.events}{" "}
                  events -{" "}
                  {x.complete
                    ? "All returned pages fetched; earlier inventory still may be unknown"
                    : "Incomplete: " + x.stopReason}
                </p>
              ))}
              <p>{report.warning}</p>
              <p>
                Only observed historical payouts/loss events settle positions.
                Open positions remain unvalued. Realized drawdown excludes
                open-position losses.
              </p>
            </section>
            <section className="paper-card">
              <h2>Strategy comparison</h2>
              <div className="backtest-table-wrap">
                <table className="backtest-table">
                  <thead>
                    <tr>
                      <th>Strategy</th>
                      <th>Realized modeled P&amp;L</th>
                      <th>Unvalued open cost</th>
                      <th>Available cash</th>
                      <th>Realized drawdown</th>
                      <th>Buy / skip</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.results.map((r) => (
                      <tr key={r.strategy}>
                        <td>{r.strategy}</td>
                        <td>{usd(r.realizedPnl)}</td>
                        <td>
                          {usd(r.openCost)} ({r.openPositions})
                        </td>
                        <td>{usd(r.cash)}</td>
                        <td>{usd(r.realizedDrawdown)}</td>
                        <td>
                          {r.copied} / {r.skipped}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                No strategy is crowned a winner while open exposure and
                historical execution remain uncertain.
              </p>
            </section>
            <section className="paper-card">
              <h2>Earlier sample vs later sample</h2>
              <p>
                The first 70% of observed event timestamps define the split
                {report.cut !== null
                  ? " at " + new Date(report.cut * 1000).toLocaleString()
                  : ""}
                . Each period starts with a fresh budget and no positions. Exits
                without matching entries cannot establish returns; this is a
                diagnostic split, not validated walk-forward selection.
              </p>
              {report.results.map((r) => (
                <div className="paper-position" key={r.strategy}>
                  <strong>{r.strategy}</strong>
                  <span>
                    Earlier realized: {usd(r.training)} / Later realized:{" "}
                    {usd(r.holdout)}
                  </span>
                </div>
              ))}
            </section>
            <section className="paper-card">
              <h2>Replay receipts</h2>
              {report.results.map((r) => (
                <details key={r.strategy}>
                  <summary>
                    {r.strategy}: {r.copied} modeled buys, {r.closed} closed
                    positions, {usd(r.modeledFees)} assumed fees
                  </summary>
                  {r.receipts.map((x, i) => (
                    <div className="paper-receipt" key={i}>
                      <span className="beta">{x.decision}</span>
                      <div>
                        <strong>{x.title}</strong>
                        <p>{x.reason}</p>
                        <small>{new Date(x.at * 1000).toLocaleString()}</small>
                      </div>
                    </div>
                  ))}
                </details>
              ))}
            </section>
          </>
        )}
      </main>
    </>
  );
}
