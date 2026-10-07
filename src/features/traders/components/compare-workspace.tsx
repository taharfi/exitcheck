"use client";
import { AppHeader } from "@/components/app-header";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { decimalToMicro, decimal, money } from "@/lib/amounts";
import { useWatchlist } from "./use-watchlist";
import type { replay } from "@/features/backtesting/backtest";
import type { historyCoverage } from "@/features/traders/history-loader";
import type { summarizeOverlap } from "@/features/traders/overlap";
type Report = {
  owners: string[];
  budget: string;
  feeBps: number;
  slippageBps: number;
  from: number | null;
  to: number | null;
  commonWindow: boolean;
  coverage: ReturnType<typeof historyCoverage>[];
  individual: (ReturnType<typeof replay> & { owner: string })[];
  combined: ReturnType<typeof replay> | null;
  overlap: {
    groups: ReturnType<typeof summarizeOverlap>;
    verified: boolean;
    coverage: {
      owner: string;
      complete: boolean;
      unknownEvents: number;
      reason: string;
      openPositions: number;
      at: number;
    }[];
  };
  warning: string;
};
const usd = (s: string) =>
    s.startsWith("-") ? "-" + money(s.slice(1)) : money(s),
  short = (s: string) => s.slice(0, 6) + "..." + s.slice(-5);
export function CompareWorkspace() {
  const saved = useWatchlist(),
    [owners, setOwners] = useState<string[]>([]),
    [entry, setEntry] = useState(""),
    [budget, setBudget] = useState("100"),
    [fee, setFee] = useState("100"),
    [slippage, setSlippage] = useState("100"),
    [report, setReport] = useState<Report | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    async function initialize() {
      await Promise.resolve();
      const requestedBudget = new URLSearchParams(window.location.search).get(
        "budget",
      );
      if (
        requestedBudget &&
        /^\d+(\.\d{1,2})?$/.test(requestedBudget) &&
        Number(requestedBudget) >= 100 &&
        Number(requestedBudget) <= 1_000_000
      )
        setBudget(requestedBudget);
      const seeds = [
        ...new Set(new URLSearchParams(window.location.search).getAll("owner")),
      ]
        .filter((x) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x))
        .slice(0, 3);
      setOwners(seeds);
    }
    void initialize();
  }, []);
  function select(owner: string) {
    generation.current++;
    setBusy(false);
    setReport(null);
    setError("");
    setOwners((xs) =>
      xs.includes(owner)
        ? xs.filter((x) => x !== owner)
        : xs.length < 3
          ? [...xs, owner]
          : xs,
    );
  }
  function add() {
    const owner = entry.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner)) {
      setError("Enter a Solana public wallet address.");
      return;
    }
    if (owners.includes(owner)) {
      setError("This wallet is already selected.");
      return;
    }
    if (owners.length >= 3) {
      setError("Select up to three wallets.");
      return;
    }
    select(owner);
    setEntry("");
  }
  async function analyze() {
    if (!owners.length || busy) return;
    const id = ++generation.current;
    setBusy(true);
    setError("");
    setReport(null);
    try {
      const q = new URLSearchParams({
        budget: decimalToMicro(budget).toString(),
        fee,
        slippage,
      });
      owners.forEach((owner) => q.append("owner", owner));
      const r = await fetch("/api/compare?" + q, {
          cache: "no-store",
          signal: AbortSignal.timeout(180000),
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error?.message ?? "Comparison unavailable.");
      if (generation.current === id) setReport(j);
    } catch (e) {
      if (generation.current === id)
        setError(
          e instanceof Error ? e.message : "Could not compare these wallets.",
        );
    } finally {
      if (generation.current === id) setBusy(false);
    }
  }
  const paperLink = report
    ? "/paper?" +
      new URLSearchParams([
        ...report.owners.map((owner) => ["wallet", owner]),
        ["budget", decimal(report.budget)],
      ])
    : "/paper";
  return (
    <>
      <AppHeader />
      <main className="paper-main">
        <div className="paper-intro">
          <p className="eyebrow">BUILD YOUR VIRTUAL PORTFOLIO</p>
          <h1>
            Compare records.
            <br />
            Check shared exposure.
          </h1>
          <p>
            Choose up to three wallets. Test each with the same budget, then see
            what happens when that budget is shared.
          </p>
        </div>
        <section className="paper-card">
          <h2>Saved watchlist</h2>
          <p>Public addresses saved only in this browser.</p>
          {saved.error && <p role="alert">{saved.error}</p>}
          {saved.wallets.length ? (
            <div className="watchlist-chips">
              {saved.wallets.map((owner) => (
                <div key={owner}>
                  <button
                    className="text-button"
                    aria-pressed={owners.includes(owner)}
                    disabled={!owners.includes(owner) && owners.length === 3}
                    onClick={() => select(owner)}
                  >
                    {short(owner)}
                  </button>
                  <button
                    className="text-button"
                    onClick={() => saved.toggle(owner)}
                  >
                    Remove saved<span className="sr-only"> {owner}</span>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p>
              No saved wallets yet.{" "}
              <Link href="/discover">Explore trader records</Link> to save some.
            </p>
          )}
        </section>
        <section className="paper-card">
          <div className="paper-section-title">
            <div>
              <h2>Your selection ({owners.length}/3)</h2>
              <p>
                Wallets have equal budget ceilings. These allocations are a
                baseline, not an optimal risk model.
              </p>
            </div>
            <Link href="/discover">Add from Discover</Link>
          </div>
          {owners.map((owner) => (
            <div className="paper-position" key={owner}>
              <span className="discover-address">{owner}</span>
              <div>
                <button
                  className="text-button"
                  onClick={() => saved.toggle(owner)}
                >
                  {saved.wallets.includes(owner) ? "Unsave" : "Save"}
                  <span className="sr-only"> {owner}</span>
                </button>
                <button className="text-button" onClick={() => select(owner)}>
                  Remove selected<span className="sr-only"> {owner}</span>
                </button>
              </div>
            </div>
          ))}
          <div className="compare-add">
            <label>
              Add a public wallet
              <input
                value={entry}
                onChange={(e) => setEntry(e.target.value)}
                placeholder="Solana public address"
              />
            </label>
            <button
              className="text-button"
              onClick={add}
              disabled={owners.length === 3}
            >
              Add wallet
            </button>
          </div>
          <div className="backtest-settings">
            <label>
              Virtual budget (USD)
              <input
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                inputMode="decimal"
              />
            </label>
            <label>
              Assumed fee (bps)
              <input
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                inputMode="numeric"
              />
            </label>
            <label>
              Adverse slippage (bps)
              <input
                value={slippage}
                onChange={(e) => setSlippage(e.target.value)}
                inputMode="numeric"
              />
            </label>
          </div>
          <p>
            100 bps = 1%. Each wallet is simulated separately with this full
            starting budget. The portfolio below uses one shared budget.
            Historical depth and actual follower fees are unverified.
          </p>
          <button
            className="paper-primary"
            disabled={!owners.length || busy}
            onClick={() => void analyze()}
          >
            {busy
              ? "Loading history and positions..."
              : "Compare and check overlap"}
          </button>
        </section>
        {error && (
          <p className="paper-error" role="alert">
            {error}
          </p>
        )}
        {report && (
          <>
            <section className="paper-card">
              <h2>Comparable history</h2>
              <p>
                {report.commonWindow &&
                report.from !== null &&
                report.to !== null
                  ? "Shared observed range: " +
                    new Date(report.from * 1000).toLocaleString() +
                    " to " +
                    new Date(report.to * 1000).toLocaleString()
                  : "No shared observed window is available. Historical returns cannot be compared for this selection."}
              </p>
              {report.coverage.map((c) => (
                <div className="paper-position" key={c.owner}>
                  <div>
                    <strong>{short(c.owner)}</strong>
                    <p>
                      {c.events} imported events /{" "}
                      {c.reportedTotal === null
                        ? "provider total unknown"
                        : c.reportedTotal + " provider-reported total"}{" "}
                      / {c.pages} pages
                    </p>
                  </div>
                  <div>
                    <strong>
                      {c.complete
                        ? "Returned pages fetched"
                        : "Incomplete coverage"}
                    </strong>
                    <p>{c.stopReason}</p>
                  </div>
                </div>
              ))}
              <p>
                {report.warning} Missing data is not zero activity. Current
                winners are a retrospectively selected sample.
              </p>
            </section>
            {report.commonWindow && (
              <section className="paper-card">
                <h2>Each wallet, tested separately</h2>
                <p>
                  Starting budget {usd(report.budget)} for each / assumed fee{" "}
                  {report.feeBps} bps / slippage {report.slippageBps} bps. Same
                  small-entry rules and shared time window, with no starting
                  holdings.
                </p>
                <div className="backtest-table-wrap">
                  <table className="backtest-table">
                    <thead>
                      <tr>
                        <th>Wallet</th>
                        <th>Realized modeled P&amp;L</th>
                        <th>Open cost, unvalued</th>
                        <th>Available cash</th>
                        <th>Realized drawdown</th>
                        <th>Buy / skip</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.individual.map((r) => (
                        <tr key={r.owner}>
                          <td title={r.owner}>{short(r.owner)}</td>
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
                  Drawdown excludes unrealized losses. Open exposure and missing
                  inventory prevent a reliable winner ranking.
                </p>
              </section>
            )}
            <section className="paper-card">
              <h2>Current overlap check</h2>
              <p>
                Unresolved, unclaimed held contracts in the retrieved position
                snapshots. These are the traders’ positions, not your proposed
                allocations. Mark value is not maximum loss or guaranteed sale
                proceeds.
              </p>
              {!report.overlap.verified && (
                <p role="status" className="paper-error">
                  Overlap is incomplete. Missing positions or event identities
                  prevent a diversification conclusion.
                </p>
              )}
              {report.overlap.groups.length ? (
                report.overlap.groups.map((g) => (
                  <div className="paper-position" key={g.key}>
                    <div>
                      <strong>{g.title}</strong>
                      <p>
                        {g.owners.length} selected wallets / {g.positions} held
                        positions
                        {g.opposingSides
                          ? " / opposing sides in the same market"
                          : ""}
                        {!g.eventVerified
                          ? " / event identity unavailable; matched by market only"
                          : ""}
                      </p>
                    </div>
                    <div>
                      <strong>
                        {g.markedValue === null
                          ? "Marked value unknown"
                          : usd(g.markedValue) + " marked value"}
                      </strong>
                    </div>
                  </div>
                ))
              ) : (
                <p>
                  {report.overlap.verified
                    ? "No shared events found in these current snapshots. Future trades can still overlap."
                    : "No shared events were identified in available data; overlap remains unknown."}
                </p>
              )}
              <details>
                <summary>Position coverage by wallet</summary>
                {report.overlap.coverage.map((c) => (
                  <p key={c.owner}>
                    {short(c.owner)} /{" "}
                    {c.complete
                      ? "Returned pages fetched"
                      : "Unknown or incomplete"}{" "}
                    / {c.openPositions} included positions / {c.unknownEvents}{" "}
                    missing event identities / {c.reason} /{" "}
                    {new Date(c.at).toLocaleString()}
                  </p>
                ))}
              </details>
            </section>
            <section className="paper-card">
              <h2>One shared virtual portfolio</h2>
              <div className="paper-allocations">
                {report.owners.map((owner) => (
                  <div key={owner}>
                    <span>{short(owner)}</span>
                    <strong>
                      {usd(
                        String(
                          (BigInt(report.budget) * 70n) /
                            100n /
                            BigInt(report.owners.length),
                        ),
                      )}{" "}
                      ceiling
                    </strong>
                  </div>
                ))}
                <div>
                  <span>Cash reserve</span>
                  <strong>
                    {usd(String((BigInt(report.budget) * 30n) / 100n))}
                  </strong>
                </div>
              </div>
              <p>
                Equal ceilings keep the baseline explainable. Entries are capped
                at 5% of starting budget and each event at 10%. We do not add
                individual wallet returns together.
              </p>
              {report.combined ? (
                <>
                  <div className="discover-profile-stats">
                    <div>
                      <span>Combined realized modeled P&amp;L</span>
                      <strong>{usd(report.combined.realizedPnl)}</strong>
                    </div>
                    <div>
                      <span>Unvalued open cost</span>
                      <strong>{usd(report.combined.openCost)}</strong>
                    </div>
                    <div>
                      <span>Available virtual cash</span>
                      <strong>{usd(report.combined.cash)}</strong>
                    </div>
                    <div>
                      <span>Modeled buys / skipped buys</span>
                      <strong>
                        {report.combined.copied} / {report.combined.skipped}
                      </strong>
                    </div>
                  </div>
                  <details>
                    <summary>Combined decision receipts</summary>
                    {report.combined.receipts.map((r, i) => (
                      <div className="paper-receipt" key={i}>
                        <span className="beta">{r.decision}</span>
                        <div>
                          <strong>{r.title}</strong>
                          <p>{r.reason}</p>
                        </div>
                      </div>
                    ))}
                  </details>
                </>
              ) : (
                <p>
                  A combined historical simulation is unavailable without a
                  shared time window. Forward paper observation is still
                  available.
                </p>
              )}
              <Link className="paper-primary discover-follow" href={paperLink}>
                Start paper tracking
              </Link>
              <Link
                className="text-button shadow-handoff"
                href={
                  "/shadow?" +
                  new URLSearchParams([
                    ...report.owners.map((owner) => ["owner", owner]),
                    ["budget", report.budget],
                  ])
                }
              >
                Start background shadow observation
              </Link>
              <p>
                Opens setup with this selection and budget. You start a fresh
                virtual observation session; historical balances are not carried
                forward. An existing local portfolio is preserved. No real
                trades or signatures.
              </p>
            </section>
          </>
        )}
      </main>
    </>
  );
}
