"use client";
import { AppHeader } from "@/components/app-header";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { decimalToMicro, decimal, money } from "@/lib/amounts";
import type { Paper, Trader } from "@/features/copy-trading/paper";
import type { Observation } from "@/features/copy-trading/shadow-store";
import { useWatchlist } from "../../traders/components/use-watchlist";
import { CopyabilityPanel } from "../../traders/components/copyability-panel";
import { AccountConnection } from "../../account/components/account-connection";
type Snapshot = {
  portfolio: {
    id: string;
    paper: Paper;
    createdAt: number;
    expiresAt: number;
    lastPoll: number | null;
    lastSuccess: number | null;
    error: string | null;
    gaps: number;
    polls: number;
  } | null;
  collectorEnabled: boolean;
  observations: Observation[];
  coverage: string;
};
const short = (s: string) => s.slice(0, 6) + "…" + s.slice(-5);
export function ShadowWorkspace() {
  const saved = useWatchlist(),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [owners, setOwners] = useState<string[]>([]),
    [entry, setEntry] = useState(""),
    [budget, setBudget] = useState("100"),
    [error, setError] = useState(""),
    [checkedAt, setCheckedAt] = useState(0),
    [busy, setBusy] = useState(false);
  const [traders, setTraders] = useState<Trader[]>([]),
    [tradersLoading, setTradersLoading] = useState(true),
    [tradersError, setTradersError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      try {
        const r = await fetch("/api/discover?period=monthly", {
            signal: abort.signal,
          }),
          j = await r.json();
        if (!r.ok)
          throw Error(j.error?.message ?? "Trader records unavailable.");
        if (!abort.signal.aborted)
          setTraders(
            j.traders
              .filter(
                (t: Trader) =>
                  BigInt(t.realizedPnlUsd) > 0n &&
                  BigInt(t.predictionsCount) >= 10n,
              )
              .slice(0, 6),
          );
      } catch (e) {
        if (!abort.signal.aborted)
          setTradersError(
            e instanceof Error ? e.message : "Trader records unavailable.",
          );
      } finally {
        if (!abort.signal.aborted) setTradersLoading(false);
      }
    }
    void load();
    return () => abort.abort();
  }, []);
  const refresh = useCallback(async () => {
    const r = await fetch("/api/shadow", {
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      }),
      j = await r.json();
    if (!r.ok)
      throw Error(j.error?.message ?? "Background portfolio unavailable.");
    setSnapshot(j);
    setCheckedAt(Date.now());
  }, []);
  useEffect(() => {
    let mounted = true;
    async function initialize() {
      await Promise.resolve();
      if (!mounted) return;
      const q = new URLSearchParams(window.location.search);
      setOwners(
        [...new Set(q.getAll("owner"))]
          .filter((x) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x))
          .slice(0, 3),
      );
      const seed = q.get("budget");
      if (seed && /^\d{1,13}$/.test(seed)) setBudget(decimal(seed));
      try {
        await refresh();
      } catch (e) {
        if (mounted)
          setError(
            e instanceof Error ? e.message : "Could not load observation.",
          );
      }
    }
    void initialize();
    const timer = setInterval(
      () =>
        void refresh().catch(() => {
          if (mounted)
            setError(
              "Could not refresh server status. Observation may be interrupted.",
            );
        }),
      15000,
    );
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    const reload = () =>
      void refresh().catch(() =>
        setError(
          "Could not load your account portfolio. Refresh to try again.",
        ),
      );
    window.addEventListener("exitcheck-account", reload);
    return () => window.removeEventListener("exitcheck-account", reload);
  }, [refresh]);
  function select(owner: string) {
    setOwners((xs) =>
      xs.includes(owner)
        ? xs.filter((x) => x !== owner)
        : xs.length < 3
          ? [...xs, owner]
          : xs,
    );
  }
  function add() {
    const value = entry.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
      setError("Enter a Solana public wallet address.");
      return;
    }
    if (owners.includes(value) || owners.length >= 3) {
      setError("Select up to three different wallets.");
      return;
    }
    select(value);
    setEntry("");
    setError("");
  }
  async function act(action: "start" | "pause" | "resume" | "stop") {
    setBusy(true);
    setError("");
    try {
      const input =
        action === "start"
          ? { action, owners, budget: decimalToMicro(budget).toString() }
          : { action };
      const r = await fetch("/api/shadow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
        j = await r.json();
      if (!r.ok)
        throw Error(j.error?.message ?? "Could not update observation.");
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not update observation.",
      );
    } finally {
      setBusy(false);
    }
  }
  const row = snapshot?.portfolio,
    paper = row?.paper;
  const active = paper?.positions.filter((p) => !p.settled) ?? [];
  const realized =
    paper?.positions
      .filter((p) => p.settled)
      .reduce((s, p) => s + BigInt(p.payout ?? "0") - BigInt(p.cost), 0n) ?? 0n;
  const expired = row ? row.expiresAt <= checkedAt : false;
  const stale = row?.lastSuccess ? checkedAt - row.lastSuccess > 90000 : false;
  let proposed: string | null = null;
  try {
    const value = decimalToMicro(budget);
    if (value >= 100000000n && value <= 1000000000000n)
      proposed = String(value);
  } catch {}
  return (
    <>
      <AppHeader />
      <main className="paper-main">
        <AccountConnection />
        <div className="paper-intro">
          <p className="eyebrow">COPY TRADING · VIRTUAL MODE</p>
          <h1>
            Pick traders.
            <br />
            Set a budget. Try it.
          </h1>
          <p>
            Follow one to three prediction-market traders with virtual funds. We
            track sampled trades and explain each copy or skip.
          </p>
        </div>
        <div className="paper-notice">
          <strong>No deposit needed. Your money stays untouched.</strong>
          <p>
            Virtual tracking runs for seven days while this server is online,
            even with your browser closed. The trade feed is sampled, so some
            trades may be missed.
          </p>
        </div>
        {error && (
          <p role="alert" className="paper-error">
            {error}
          </p>
        )}
        {!snapshot ? (
          <p role="status">Loading background status...</p>
        ) : !paper ? (
          <section className="paper-card">
            <p className="eyebrow">STEP 1</p>
            <h2>Choose your traders</h2>
            <p>Pick up to three wallets. Each gets an equal budget ceiling.</p>
            {saved.wallets.length > 0 && (
              <div className="watchlist-chips">
                {saved.wallets.map((owner) => (
                  <button
                    className="text-button"
                    key={owner}
                    onClick={() => select(owner)}
                    aria-pressed={owners.includes(owner)}
                    disabled={!owners.includes(owner) && owners.length === 3}
                  >
                    {short(owner)}
                  </button>
                ))}
              </div>
            )}
            {saved.error && <p role="status">{saved.error}</p>}
            {tradersLoading ? (
              <p role="status">Loading public trader records...</p>
            ) : tradersError ? (
              <p role="status">
                {tradersError} You can still add an address below.
              </p>
            ) : (
              <>
                <div className="copy-picks">
                  {traders.map((t) => (
                    <button
                      key={t.ownerPubkey}
                      className="copy-pick"
                      aria-pressed={owners.includes(t.ownerPubkey)}
                      disabled={
                        !owners.includes(t.ownerPubkey) && owners.length === 3
                      }
                      onClick={() => select(t.ownerPubkey)}
                    >
                      <span className="copy-pick-name">
                        {short(t.ownerPubkey)}
                        <span>
                          {owners.includes(t.ownerPubkey)
                            ? "Selected ✓"
                            : "Select +"}
                        </span>
                      </span>
                      <strong>{money(t.realizedPnlUsd)}</strong>
                      <small>
                        Reported monthly profit · {t.predictionsCount}{" "}
                        predictions
                      </small>
                    </button>
                  ))}
                </div>
                <p className="discover-caption">
                  From the monthly profit ranking, with at least 10 predictions.
                  Past profit does not predict your returns.{" "}
                  <Link href="/discover">Explore all traders</Link>
                </p>
              </>
            )}
            <div className="compare-add">
              <label>
                Add a public wallet
                <input
                  value={entry}
                  onChange={(e) => setEntry(e.target.value)}
                  placeholder="Solana public address"
                />
              </label>
              <button className="text-button" onClick={add}>
                Add wallet
              </button>
            </div>
            <div
              className="paper-selected-wallets"
              aria-label="Selected wallets"
            >
              {owners.map((owner) => (
                <div key={owner}>
                  <span className="discover-address">{owner}</span>
                  <button className="text-button" onClick={() => select(owner)}>
                    Remove<span className="sr-only"> {owner}</span>
                  </button>
                </div>
              ))}
            </div>
            <label className="shadow-budget">
              <span className="eyebrow">STEP 2</span>
              <br />
              Virtual budget (USD)
              <input
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                inputMode="decimal"
              />
            </label>
            <p>
              Buys are simulated. Sell signals are recorded but not copied. Fees
              and executable depth are unverified.
            </p>
            <div className="budget-presets" aria-label="Budget presets">
              {["100", "250", "500"].map((value) => (
                <button
                  className="text-button"
                  key={value}
                  aria-pressed={budget === value}
                  onClick={() => setBudget(value)}
                >
                  ${value}
                </button>
              ))}
            </div>
            {proposed && (
              <div className="copy-budget-preview">
                <div>
                  <span>Cash reserve</span>
                  <strong>
                    {money(String((BigInt(proposed) * 30n) / 100n))}
                  </strong>
                </div>
                <div>
                  <span>Each trader’s ceiling</span>
                  <strong>
                    {owners.length
                      ? money(
                          String(
                            (BigInt(proposed) * 70n) /
                              100n /
                              BigInt(owners.length),
                          ),
                        )
                      : "Choose a trader"}
                  </strong>
                </div>
                <div>
                  <span>Maximum per entry</span>
                  <strong>{money(String(BigInt(proposed) / 20n))}</strong>
                </div>
              </div>
            )}
            <details className="copy-details">
              <summary>How the limits work</summary>
              <p>
                30% stays in reserve. The other 70% is split into equal trader
                ceilings, not invested immediately. Each entry is capped at 5%
                of the starting budget, each event at 10%, with a $5 minimum
                entry. Duplicate and opposing positions in a held market are
                blocked. A realized loss of 10% pauses new entries. Open
                positions can still lose.
              </p>
            </details>
            {!snapshot.collectorEnabled && (
              <p role="status" className="paper-error">
                Background collection is disabled on this server. Start using
                npm start or enable SHADOW_COLLECTOR_ENABLED for development.
              </p>
            )}
            <button
              className="paper-primary"
              disabled={
                busy ||
                !owners.length ||
                !snapshot.collectorEnabled ||
                !proposed
              }
              onClick={() => void act("start")}
            >
              {busy ? "Starting..." : "Start virtual copy trading"}
            </button>
          </section>
        ) : (
          <>
            <section className="paper-card">
              <p className="eyebrow">YOUR TRADERS</p>
              <div className="watchlist-chips">
                {paper.owners.map((owner) => (
                  <span key={owner} className="copy-owner" title={owner}>
                    {short(owner)}
                  </span>
                ))}
              </div>
              <div className="paper-section-title">
                <div>
                  <p className="eyebrow">SERVER-SIDE OBSERVATION</p>
                  <h2>
                    {!snapshot.collectorEnabled
                      ? "Background collector disabled"
                      : expired
                        ? "Session ended"
                        : paper.paused
                          ? "Observation paused"
                          : row?.error || stale
                            ? "Observation interrupted"
                            : row?.lastSuccess
                              ? "Observing sampled trades"
                              : "Waiting for first collection"}
                  </h2>
                </div>
                <span className="research-badge">
                  Virtual budget {money(paper.budget)}
                </span>
              </div>
              <details className="copy-details">
                <summary>Collection status and gaps</summary>
                <p>
                  Last successful collection:{" "}
                  {row?.lastSuccess
                    ? new Date(row.lastSuccess).toLocaleString()
                    : "Not collected yet"}
                  . {row?.polls} successful polls · {row?.gaps} recorded
                  interruption/resume gaps.
                </p>
              </details>
              {row?.error && (
                <p role="status" className="paper-error">
                  Feed error: {row.error}. No new entries are created without
                  validated data.
                </p>
              )}
              <p>
                Session ends {new Date(row!.expiresAt).toLocaleString()}. Guest
                portfolios require this browser&apos;s cookie. Sign in above to
                link a guest portfolio to your wallet when no wallet portfolio
                exists.
              </p>
              <div className="shadow-actions">
                {!expired && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void act(paper.paused ? "resume" : "pause")}
                  >
                    {paper.paused
                      ? "Resume background observation"
                      : "Pause background observation"}
                  </button>
                )}
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void act("stop")}
                >
                  Stop and clear portfolio
                </button>
              </div>
              <div className="discover-profile-stats">
                <div>
                  <span>Available virtual cash</span>
                  <strong>{money(paper.cash)}</strong>
                </div>
                <div>
                  <span>Open cost, unvalued</span>
                  <strong>
                    {money(
                      String(active.reduce((s, p) => s + BigInt(p.cost), 0n)),
                    )}
                  </strong>
                </div>
                <div>
                  <span>Virtual entries</span>
                  <strong>{paper.positions.length}</strong>
                </div>
                <div>
                  <span>Realized virtual P&amp;L</span>
                  <strong>
                    {realized < 0n
                      ? "-" + money(String(-realized))
                      : money(String(realized))}
                  </strong>
                  <small>Excludes open positions and fees</small>
                </div>
              </div>
            </section>
            <section className="paper-card">
              <h2>Open virtual positions</h2>
              {!active.length ? (
                <p className="paper-empty">
                  No open positions yet. We wait for new sampled trades;
                  previous history is not copied.
                </p>
              ) : (
                active.map((p) => (
                  <div className="paper-position" key={p.id}>
                    <div>
                      <strong>{p.title}</strong>
                      <p>
                        {p.side.toUpperCase()} · {short(p.owner)}
                      </p>
                    </div>
                    <div>
                      <strong>{money(p.cost)}</strong>
                      <small>Entry cost · Current value unverified</small>
                    </div>
                  </div>
                ))
              )}
            </section>
            <section className="paper-card">
              <p className="eyebrow">THE DECISION FEED</p>
              <h2>What happened, and why</h2>
              <p>
                {snapshot.coverage} Quote availability is evidence about the
                snapshot, not proof of execution.
              </p>
              {!paper.journal.length && (
                <p className="paper-empty">
                  Waiting for a new sampled trade from your selected wallets.
                  Existing history is not replayed as a new trade.
                </p>
              )}
              {paper.journal.slice(0, 50).map((r, i) => (
                <div className="paper-receipt" key={r.id + ":" + i}>
                  <span className="beta">{r.decision}</span>
                  <div>
                    <strong>{r.title}</strong>
                    <p>{r.reason}</p>
                    <small>{new Date(r.at).toLocaleString()}</small>
                  </div>
                </div>
              ))}
              <details>
                <summary>Observed signal and quote evidence</summary>
                {snapshot.observations?.length ? (
                  snapshot.observations.map((o) => (
                    <div
                      className="paper-receipt"
                      key={o.trade.ownerPubkey + o.trade.id}
                    >
                      <div>
                        <strong>
                          {o.trade.eventTitle} · {o.trade.action.toUpperCase()}{" "}
                          {o.trade.side.toUpperCase()}
                        </strong>
                        <p>
                          {short(o.trade.ownerPubkey)} · Detected{" "}
                          {Math.round(o.delayMs / 1000)} seconds after provider
                          timestamp ·{" "}
                          {o.quote
                            ? "Indicative market snapshot recorded"
                            : "Quote unavailable"}
                          {o.premiumBps !== null
                            ? " · Indicative buy quote difference " +
                              o.premiumBps +
                              " bps from leader price"
                            : ""}
                        </p>
                        <small>
                          {new Date(o.observedAt).toLocaleString()} · Fees and
                          execution depth unverified.
                        </small>
                      </div>
                    </div>
                  ))
                ) : (
                  <p>No new signal evidence has been collected.</p>
                )}
              </details>
            </section>
            <section className="paper-card">
              <details>
                <summary>Trader research and copyability reports</summary>
                {paper.owners.map((owner) => (
                  <div key={owner}>
                    <p className="discover-address">{owner}</p>
                    <CopyabilityPanel
                      owner={owner}
                      budget={decimal(paper.budget)}
                    />
                  </div>
                ))}
              </details>
            </section>
          </>
        )}
      </main>
    </>
  );
}
