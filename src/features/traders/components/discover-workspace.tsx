"use client";
import { AppHeader } from "@/components/app-header";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { decimalToMicro, money } from "@/lib/amounts";
import type { Trader, Trade } from "@/features/copy-trading/paper";
import type { replay } from "@/features/backtesting/backtest";
import { useWatchlist } from "@/features/traders/components/use-watchlist";
import { CopyabilityPanel } from "@/features/traders/components/copyability-panel";
type Row = Trader & {
  period: string;
  periodStart: string | null;
  periodEnd: string | null;
};
type Board = {
  traders: Row[];
  activity: Trade[];
  activityAvailable: boolean;
  retrievedAt: number;
  coverage: string;
};
type Profile = {
  realizedPnlUsd: string;
  totalVolumeUsd: string;
  totalPositionsValueUsd: string;
  totalActiveContractsMicro: string;
  predictionsCount: string;
  correctPredictions: string;
  wrongPredictions: string;
};
type Simulation = {
  budget: string;
  feeBps: number;
  slippageBps: number;
  coverage: { events: number; complete: boolean; stopReason: string }[];
  from: number | null;
  to: number | null;
  results: ReturnType<typeof replay>[];
};
const usd = (s: string) =>
  s.startsWith("-") ? "-" + money(s.slice(1)) : money(s);
const short = (s: string) => s.slice(0, 6) + "..." + s.slice(-5);
export function DiscoverWorkspace() {
  const saved = useWatchlist();
  const [compareOwners, setCompareOwners] = useState<string[]>([]);
  const compareLink =
    "/compare?" +
    new URLSearchParams(compareOwners.map((owner) => ["owner", owner]));
  function toggleCompare(owner: string) {
    setCompareOwners((xs) =>
      xs.includes(owner)
        ? xs.filter((x) => x !== owner)
        : xs.length < 3
          ? [...xs, owner]
          : xs,
    );
  }

  const [board, setBoard] = useState<Board | null>(null),
    [period, setPeriod] = useState("monthly"),
    [search, setSearch] = useState(""),
    [minimum, setMinimum] = useState("10"),
    [profitable, setProfitable] = useState(true),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState<Row | null>(null),
    [profile, setProfile] = useState<Profile | null>(null),
    [profileError, setProfileError] = useState(""),
    [budget, setBudget] = useState("100"),
    [fee, setFee] = useState("100"),
    [slippage, setSlippage] = useState("100"),
    [simulation, setSimulation] = useState<Simulation | null>(null),
    [simError, setSimError] = useState(""),
    [simBusy, setSimBusy] = useState(false);
  const generation = useRef(0),
    panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      setBoard(null);
      try {
        const r = await fetch("/api/discover?period=" + period, {
            signal: abort.signal,
            cache: "no-store",
          }),
          j = await r.json();
        if (!r.ok) throw Error(j.error?.message ?? "Trader data unavailable.");
        if (!abort.signal.aborted) setBoard(j);
      } catch (e) {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : "Could not load traders.");
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => abort.abort();
  }, [period]);
  async function choose(row: Row) {
    const id = ++generation.current;
    setSelected(row);
    setProfile(null);
    setProfileError("");
    setSimulation(null);
    setSimError("");
    setSimBusy(false);
    setTimeout(
      () =>
        panel.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      50,
    );
    try {
      const r = await fetch("/api/discover?owner=" + row.ownerPubkey, {
          signal: AbortSignal.timeout(30000),
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error?.message ?? "Profile unavailable.");
      if (generation.current === id) setProfile(j.profile);
    } catch (e) {
      if (generation.current === id)
        setProfileError(
          e instanceof Error ? e.message : "Profile unavailable.",
        );
    }
  }
  async function simulate() {
    if (!selected || simBusy) return;
    const id = generation.current;
    setSimBusy(true);
    setSimulation(null);
    setSimError("");
    try {
      const query = new URLSearchParams({
        owner: selected.ownerPubkey,
        budget: decimalToMicro(budget).toString(),
        fee,
        slippage,
      });
      const r = await fetch("/api/backtest?" + query, {
          signal: AbortSignal.timeout(120000),
          cache: "no-store",
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error?.message ?? "Simulation unavailable.");
      if (generation.current === id) setSimulation(j);
    } catch (e) {
      if (generation.current === id)
        setSimError(e instanceof Error ? e.message : "Simulation failed.");
    } finally {
      if (generation.current === id) setSimBusy(false);
    }
  }
  const count = /^\d{1,5}$/.test(minimum) ? BigInt(minimum) : 0n;
  const rows = (board?.traders ?? []).filter(
    (t) =>
      (!profitable || BigInt(t.realizedPnlUsd) > 0n) &&
      BigInt(t.predictionsCount) >= count &&
      t.ownerPubkey.includes(search.trim()),
  );
  const result = simulation?.results.find(
    (r) => r.strategy === "Small entries",
  );
  const recent = selected
    ? (board?.activity.filter((t) => t.ownerPubkey === selected.ownerPubkey) ??
      [])
    : [];
  function changePeriod(value: string) {
    generation.current++;
    setSelected(null);
    setSimulation(null);
    setProfile(null);
    setSimBusy(false);
    setPeriod(value);
  }
  return (
    <>
      <AppHeader />
      <main className="paper-main discover-main">
        <div className="discover-hero">
          <div>
            <p className="eyebrow">DISCOVER. SIMULATE. DECIDE.</p>
            <h1>Find your next edge.</h1>
            <p>
              Explore public trader records. Test a virtual budget before
              choosing who to follow.
            </p>
          </div>
          <div className="discover-tag">
            Live Jupiter data
            <br />
            <strong>Virtual funds only</strong>
          </div>
        </div>
        <div className="research-overview" aria-label="Research overview">
          <div>
            <span>Available trader records</span>
            <strong>
              {board ? board.traders.length : "—"}
              <small>in this ranking</small>
            </strong>
          </div>
          <div>
            <span>Matching your filters</span>
            <strong>
              {board ? rows.length : "—"}
              <small>public wallets</small>
            </strong>
          </div>
          <div>
            <span>Your watchlist</span>
            <strong>
              {saved.wallets.length}
              <small>saved for later</small>
            </strong>
          </div>
          <div>
            <span>How it works</span>
            <p>
              Discover <b>→</b> Compare <b>→</b> Paper trade
            </p>
          </div>
        </div>
        <section className="paper-card discover-saved">
          <div className="paper-section-title">
            <div>
              <h2>
                Your watchlist{" "}
                <span className="beta">{saved.wallets.length} SAVED</span>
              </h2>
              <p>
                Saved in this browser. Keep interesting wallets without starting
                a portfolio.
              </p>
            </div>
            <Link href="/compare">Build a virtual portfolio</Link>
          </div>
          {saved.error && <p role="alert">{saved.error}</p>}
          {saved.wallets.length ? (
            <div className="watchlist-chips">
              {saved.wallets.map((owner) => (
                <div key={owner}>
                  <Link href={"/compare?owner=" + owner} title={owner}>
                    {short(owner)}
                  </Link>
                  <button
                    className="text-button"
                    onClick={() => saved.toggle(owner)}
                  >
                    Remove<span className="sr-only"> {owner}</span>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p>No saved wallets yet. Use Save wallet on a trader below.</p>
          )}
        </section>
        {compareOwners.length > 0 && (
          <section className="compare-tray" aria-label="Comparison selection">
            <div>
              <strong>{compareOwners.length}/3 wallets selected</strong>
              <p>
                Same budget and assumptions for each, plus a shared portfolio
                simulation.
              </p>
            </div>
            <Link className="paper-primary discover-follow" href={compareLink}>
              Compare selected wallets
            </Link>
          </section>
        )}
        <section className="paper-card discover-ranking">
          <div className="ranking-heading">
            <div>
              <p className="eyebrow">THE RESEARCH DESK</p>
              <h2>Trader leaderboard</h2>
            </div>
            <span className="research-badge">
              Public records · Virtual trading
            </span>
          </div>
          <div className="discover-controls">
            <label>
              Performance period
              <select
                value={period}
                onChange={(e) => changePeriod(e.target.value)}
              >
                <option value="monthly">This month</option>
                <option value="weekly">This week</option>
                <option value="all_time">All time</option>
              </select>
            </label>
            <label>
              Search wallet
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Paste an address or prefix"
              />
            </label>
            <label>
              Minimum predictions
              <input
                value={minimum}
                onChange={(e) => setMinimum(e.target.value)}
                inputMode="numeric"
              />
            </label>
            <label className="discover-checkbox">
              <input
                type="checkbox"
                checked={profitable}
                onChange={(e) => setProfitable(e.target.checked)}
              />{" "}
              Positive realized profit
            </label>
          </div>
          <p className="discover-caption">
            Ranked by provider-reported realized profit. Sample size matters; a
            high win rate does not establish future returns.{" "}
            {board?.traders[0]?.periodStart && (
              <>
                Period:{" "}
                {new Date(board.traders[0].periodStart).toLocaleDateString()} to{" "}
                {new Date(
                  board.traders[0].periodEnd ?? board.traders[0].periodStart,
                ).toLocaleDateString()}
                .
              </>
            )}
          </p>
          {loading ? (
            <p role="status" className="paper-empty">
              Loading verified trader records...
            </p>
          ) : error ? (
            <p role="alert" className="paper-error">
              {error}
            </p>
          ) : rows.length === 0 ? (
            <p className="paper-empty">
              No wallets match these filters in the available ranking. Try a
              lower minimum or another period.
            </p>
          ) : (
            <div className="discover-list">
              {rows.map((t, i) => {
                const trade = board?.activity.find(
                  (x) => x.ownerPubkey === t.ownerPubkey,
                );
                return (
                  <article
                    className={
                      "discover-row " +
                      (selected?.ownerPubkey === t.ownerPubkey ? "active" : "")
                    }
                    key={t.ownerPubkey}
                  >
                    <div className="discover-identity">
                      <span className="discover-rank">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <strong title={t.ownerPubkey}>
                          {short(t.ownerPubkey)}
                        </strong>
                        <small>Public wallet</small>
                      </div>
                    </div>
                    <div
                      className={
                        t.realizedPnlUsd.startsWith("-")
                          ? "metric-negative"
                          : "metric-positive"
                      }
                    >
                      <span className="discover-metric-label">
                        Realized profit
                      </span>
                      <strong>{usd(t.realizedPnlUsd)}</strong>
                    </div>
                    <div>
                      <span className="discover-metric-label">Predictions</span>
                      <strong>{t.predictionsCount}</strong>
                      <small>
                        {t.correctPredictions} wins / {t.wrongPredictions}{" "}
                        losses
                      </small>
                    </div>
                    <div>
                      <span className="discover-metric-label">Win rate</span>
                      <strong>{t.winRatePct}%</strong>
                      <small>
                        {trade
                          ? "Seen " +
                            new Date(
                              Number(trade.timestamp) * 1000,
                            ).toLocaleTimeString()
                          : "Not seen in recent sample"}
                      </small>
                    </div>
                    <div className="discover-row-actions">
                      <button
                        className="text-button"
                        aria-pressed={saved.wallets.includes(t.ownerPubkey)}
                        onClick={() => saved.toggle(t.ownerPubkey)}
                      >
                        {saved.wallets.includes(t.ownerPubkey)
                          ? "Saved wallet"
                          : "Save wallet"}
                        <span className="sr-only"> {t.ownerPubkey}</span>
                      </button>
                      <button
                        className="text-button"
                        aria-pressed={compareOwners.includes(t.ownerPubkey)}
                        disabled={
                          !compareOwners.includes(t.ownerPubkey) &&
                          compareOwners.length === 3
                        }
                        onClick={() => toggleCompare(t.ownerPubkey)}
                      >
                        {compareOwners.includes(t.ownerPubkey)
                          ? "Remove from comparison"
                          : "Add to comparison"}
                        <span className="sr-only"> {t.ownerPubkey}</span>
                      </button>
                      <button
                        className="paper-primary"
                        onClick={() => void choose(t)}
                      >
                        Simulate copying
                        <span className="sr-only"> {t.ownerPubkey}</span>
                      </button>
                      <button
                        className="text-button"
                        onClick={() => void choose(t)}
                      >
                        View record
                        <span className="sr-only"> {t.ownerPubkey}</span>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          <p className="discover-caption">
            {board?.coverage}{" "}
            {!board?.activityAvailable && board
              ? "Recent activity could not be retrieved."
              : ""}{" "}
            {board
              ? "Retrieved " + new Date(board.retrievedAt).toLocaleString()
              : ""}
          </p>
        </section>
        {selected && (
          <section
            ref={panel}
            className="discover-profile paper-card"
            aria-label="Trader profile and simulator"
          >
            <div className="paper-section-title">
              <div>
                <p className="eyebrow">TRADER RECORD</p>
                <h2>{short(selected.ownerPubkey)}</h2>
                <p className="discover-address">{selected.ownerPubkey}</p>
              </div>
              <button
                className="text-button"
                onClick={() => {
                  generation.current++;
                  setSelected(null);
                  setSimBusy(false);
                }}
              >
                Close profile
              </button>
            </div>
            <div className="discover-profile-stats">
              <div>
                <span>Selected-period profit</span>
                <strong>{usd(selected.realizedPnlUsd)}</strong>
              </div>
              <div>
                <span>Predictions this period</span>
                <strong>{selected.predictionsCount}</strong>
              </div>
              <div>
                <span>All-time realized P&amp;L</span>
                <strong>
                  {profile ? usd(profile.realizedPnlUsd) : "Not verified yet"}
                </strong>
              </div>
              <div>
                <span>Current holdings mark value</span>
                <strong>
                  {profile
                    ? usd(profile.totalPositionsValueUsd)
                    : "Not verified yet"}
                </strong>
              </div>
            </div>
            {profileError && (
              <p role="alert">
                {profileError} Simulation can still use available history.
              </p>
            )}
            <Link
              className="paper-primary discover-follow"
              href={"/shadow?owner=" + selected.ownerPubkey}
            >
              Try virtual copy trading
            </Link>
            <Link
              className="paper-primary discover-follow"
              href={
                "/agent?" +
                new URLSearchParams({ trader: selected.ownerPubkey, budget })
              }
            >
              Set up a copy agent
            </Link>
            <details className="copy-details">
              <summary>Check trade history and copyability</summary>
              <CopyabilityPanel
                key={selected.ownerPubkey}
                owner={selected.ownerPubkey}
                budget={budget}
              />
            </details>
            <div className="discover-simulator">
              <div>
                <p className="eyebrow">TRY A VIRTUAL BUDGET</p>
                <h2>What if you had followed this wallet?</h2>
                <p>
                  Available historical events only. Uses small entries: 5% per
                  purchase, 30% cash reserve and 10% per event. This wallet can
                  use up to 70% of the starting budget.
                </p>
              </div>
              <label>
                Starting budget (USD)
                <input
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  inputMode="decimal"
                />
              </label>
              <details>
                <summary>Simulation settings</summary>
                <div className="backtest-settings">
                  <label>
                    Assumed fee per trade (bps)
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
                  100 bps = 1%. These are scenario assumptions, not verified
                  follower costs. Network fees and historical depth are
                  excluded.
                </p>
                <Link href="/backtest">Compare additional strategies</Link>
              </details>
              <button
                className="paper-primary"
                disabled={simBusy}
                onClick={() => void simulate()}
              >
                {simBusy ? "Importing history..." : "Run simulation"}
              </button>
            </div>
            {simError && (
              <p role="alert" className="paper-error">
                {simError}
              </p>
            )}
            {result && simulation && (
              <div className="discover-result">
                <p className="eyebrow">HYPOTHETICAL RESULT</p>
                <p>
                  Starting budget {usd(simulation.budget)} / assumed fee{" "}
                  {simulation.feeBps} bps / adverse slippage{" "}
                  {simulation.slippageBps} bps
                </p>
                <h2>{usd(result.realizedPnl)} realized modeled P&amp;L</h2>
                <p>
                  {simulation.from !== null
                    ? new Date(simulation.from * 1000).toLocaleDateString()
                    : "No events"}{" "}
                  to{" "}
                  {simulation.to !== null
                    ? new Date(simulation.to * 1000).toLocaleDateString()
                    : "no events"}
                  . Open positions are not included in that result.
                </p>
                <div className="discover-profile-stats">
                  <div>
                    <span>Available virtual cash</span>
                    <strong>{usd(result.cash)}</strong>
                  </div>
                  <div>
                    <span>Open positions at cost</span>
                    <strong>{usd(result.openCost)}</strong>
                    <small>{result.openPositions} unvalued positions</small>
                  </div>
                  <div>
                    <span>Assumed fees</span>
                    <strong>{usd(result.modeledFees)}</strong>
                  </div>
                  <div>
                    <span>Modeled buys / skipped buys</span>
                    <strong>
                      {result.copied} / {result.skipped}
                    </strong>
                  </div>
                </div>
                <div className="paper-notice">
                  <strong>
                    {simulation.coverage.every((x) => x.complete)
                      ? "Returned pages fetched; earlier inventory may still be unknown"
                      : "Incomplete historical coverage"}
                  </strong>
                  <p>
                    {simulation.coverage.map((x) => x.stopReason).join(". ")}.
                    Recorded leader fills are proxies; follower prices, latency
                    and liquidity are unverified. Selecting current winners
                    introduces hindsight bias. This is not a forecast of your
                    profit.
                  </p>
                </div>
                <details>
                  <summary>What was copied or skipped?</summary>
                  {result.receipts.map((x, i) => (
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
                <Link
                  className="paper-primary discover-follow"
                  href={"/paper?wallet=" + selected.ownerPubkey}
                >
                  Follow with virtual funds
                </Link>
                <p>
                  Opens portfolio setup. An existing portfolio is preserved.
                  Observation runs while the page is open; no real funds or
                  signatures.
                </p>
              </div>
            )}
            <details className="discover-activity">
              <summary>Recent observed trades ({recent.length})</summary>
              {recent.length ? (
                recent.map((t) => (
                  <div className="paper-position" key={t.id}>
                    <div>
                      <strong>
                        {t.eventTitle} / {t.marketTitle}
                      </strong>
                      <p>
                        {t.action} {t.side.toUpperCase()} /{" "}
                        {new Date(Number(t.timestamp) * 1000).toLocaleString()}
                      </p>
                    </div>
                    <strong>{usd(t.amountUsd)}</strong>
                  </div>
                ))
              ) : (
                <p>
                  No trades from this wallet were present in the limited recent
                  sample. This does not mean the wallet is inactive.
                </p>
              )}
            </details>
          </section>
        )}
        <p className="discover-caption">
          Wallet records describe public trading activity. Discord callers are a
          separate dataset; no identity or caller affiliation is inferred.
        </p>
      </main>
    </>
  );
}
