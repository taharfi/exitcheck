"use client";
import { AppHeader } from "@/components/app-header";
import { useCallback, useEffect, useRef, useState } from "react";
import { decimalToMicro, money } from "@/lib/amounts";
import {
  evaluatePaper,
  paperSchema,
  startPaper,
  type Paper,
  type Trader,
  type Trade,
  type Quote,
} from "@/features/copy-trading/paper";
type Feed = {
  traders: Trader[];
  trades: Trade[];
  quotes: Quote[];
  quoteErrors: string[];
  retrievedAt: number;
  coverage: string;
};
const storageKey = "exitcheck-paper-v1";
const short = (s: string) => s.slice(0, 5) + "..." + s.slice(-5);
const usd = (s: string) =>
  s.startsWith("-") ? "-" + money(s.slice(1)) : money(s);
export function PaperWorkspace() {
  const [feed, setFeed] = useState<Feed | null>(null),
    [paper, setPaper] = useState<Paper | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [budget, setBudget] = useState("100"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const current = useRef<Paper | null>(null),
    running = useRef(false),
    mounted = useRef(true);
  const save = useCallback((p: Paper) => {
    current.current = p;
    setPaper(p);
    try {
      localStorage.setItem(storageKey, JSON.stringify(p));
    } catch {
      setError(
        "Browser storage unavailable. Keep this tab open; your portfolio may not survive reload.",
      );
    }
  }, []);
  const refresh = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const p = current.current,
        params = new URLSearchParams();
      p?.owners.forEach((x) => params.append("owner", x));
      p?.positions
        .filter((x) => !x.settled)
        .slice(0, 20)
        .forEach((x) => params.append("market", x.marketId));
      const r = await fetch("/api/paper?" + params, {
          cache: "no-store",
          signal: AbortSignal.timeout(45000),
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error?.message ?? "Live feed unavailable.");
      if (!mounted.current) return;
      setFeed(j);
      setError(
        j.quoteErrors.length
          ? "Some market quotes are unavailable. Those signals are skipped; settlements wait for verified results."
          : "",
      );
      if (p && current.current === p)
        save(evaluatePaper(p, j.trades, j.quotes));
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error
            ? e.message
            : "Feed unavailable. No paper entries were created.",
        );
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [save]);
  useEffect(() => {
    mounted.current = true;
    const initialize = async () => {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        try {
          const p = paperSchema.parse(JSON.parse(raw));
          current.current = p;
          setPaper(p);
          setSelected(p.owners);
        } catch {
          setError(
            "Saved portfolio could not be read. Start a new portfolio to replace it.",
          );
        }
      }
      if (!current.current) {
        const query = new URLSearchParams(window.location.search);
        const seeds = [...new Set(query.getAll("wallet"))]
          .filter((seed) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(seed))
          .slice(0, 3);
        if (seeds.length) setSelected(seeds);
        const requested = query.get("budget");
        if (requested && /^\d+(\.\d{1,6})?$/.test(requested))
          setBudget(requested);
      }
      await refresh();
    };
    void initialize();
    const timer = setInterval(() => void refresh(), 30000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);
  const toggle = (owner: string) =>
    setSelected((xs) =>
      xs.includes(owner)
        ? xs.filter((x) => x !== owner)
        : xs.length < 3
          ? [...xs, owner]
          : xs,
    );
  const start = () => {
    try {
      save(startPaper(decimalToMicro(budget).toString(), selected));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid budget.");
    }
  };
  const active = paper?.positions.filter((x) => !x.settled) ?? [],
    committed = active.reduce((s, x) => s + BigInt(x.cost), 0n),
    realized =
      paper?.positions
        .filter((x) => x.settled)
        .reduce((s, x) => s + BigInt(x.payout ?? "0") - BigInt(x.cost), 0n) ??
      0n;
  return (
    <>
      <AppHeader
        badge="PAPER LAB"
        actions={
          <button
            className="text-button"
            onClick={() => void refresh()}
            disabled={busy}
          >
            {busy ? "Refreshing..." : "Refresh data"}
          </button>
        }
      />
      <main className="paper-main">
        <div className="paper-intro">
          <p className="eyebrow">FOLLOW ACTIVITY. TEST YOUR RULES.</p>
          <h1>
            Your first copy portfolio,
            <br />
            without risking funds.
          </h1>
          <p>
            Follow one to three public wallets with a virtual budget. Every
            entry has a reason. Every limit is visible.
          </p>
        </div>
        <div className="paper-notice">
          <strong>Paper simulation - no wallet signature</strong>
          <p>
            Uses live Jupiter wallet trades, not Discord caller predictions.
            Entries are hypothetical at current buy quotes; depth, fills and
            fees are unverified. Results exclude fees. Observation runs every 30
            seconds while this page is open.
          </p>
        </div>
        {error && (
          <p role="alert" className="paper-error">
            {error}
          </p>
        )}
        {!paper ? (
          <section className="paper-card">
            <div className="paper-section-title">
              <div>
                <h2>Build your portfolio</h2>
                <p>
                  Weekly realized P&amp;L ranking. Historical returns do not
                  determine our allocation.
                </p>
              </div>
              <label>
                Virtual budget (USD)
                <input
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  inputMode="decimal"
                  aria-label="Virtual budget (USD)"
                />
              </label>
            </div>
            <p>
              Choose up to three wallets. We keep 30% in reserve and split 70%
              equally; there is no validated caller skill model yet.
            </p>
            <div className="paper-traders">
              {feed?.traders.map((t) => (
                <button
                  key={t.ownerPubkey}
                  className={
                    "paper-trader " +
                    (selected.includes(t.ownerPubkey) ? "selected" : "")
                  }
                  onClick={() => toggle(t.ownerPubkey)}
                  aria-pressed={selected.includes(t.ownerPubkey)}
                  disabled={
                    !selected.includes(t.ownerPubkey) && selected.length === 3
                  }
                >
                  <span className="paper-wallet">{short(t.ownerPubkey)}</span>
                  <strong>{usd(t.realizedPnlUsd)}</strong>
                  <span>realized this week</span>
                  <small>
                    {t.correctPredictions} wins / {t.wrongPredictions} losses ?{" "}
                    {t.predictionsCount} predictions
                  </small>
                </button>
              )) ?? <p>Loading verified trader data...</p>}
            </div>
            {selected.length > 0 && (
              <div
                className="paper-selected-wallets"
                aria-label="Selected wallets"
              >
                {selected.map((owner) => (
                  <div key={owner}>
                    <span className="discover-address">{owner}</span>
                    <button
                      className="text-button"
                      onClick={() => toggle(owner)}
                    >
                      Remove<span className="sr-only"> {owner}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              className="paper-primary"
              onClick={start}
              disabled={selected.length < 1}
            >
              Start paper portfolio - {selected.length}/3 selected
            </button>
          </section>
        ) : (
          <>
            <section className="paper-stats">
              <div>
                <span>Available virtual cash</span>
                <strong>{usd(paper.cash)}</strong>
              </div>
              <div>
                <span>Committed cost</span>
                <strong>{usd(String(committed))}</strong>
              </div>
              <div>
                <span>Realized gross P&amp;L</span>
                <strong>{usd(String(realized))}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{paper.paused ? "Paused" : "Observing"}</strong>
              </div>
            </section>
            <section className="paper-card">
              <div className="paper-section-title">
                <div>
                  <h2>Your allocation rules</h2>
                  <p>
                    Starting budget {usd(paper.budget)} / new signals only, from{" "}
                    {new Date(paper.startedAt).toLocaleString()}
                  </p>
                </div>
                <button
                  className="text-button"
                  onClick={() => save({ ...paper, paused: !paper.paused })}
                >
                  {paper.paused ? "Resume observation" : "Pause new entries"}
                </button>
              </div>
              <div className="paper-allocations">
                {paper.owners.map((owner) => (
                  <div key={owner}>
                    <span>{short(owner)}</span>
                    <strong>
                      {usd(
                        String(
                          (BigInt(paper.budget) * 70n) /
                            100n /
                            BigInt(paper.owners.length),
                        ),
                      )}{" "}
                      ceiling
                    </strong>
                  </div>
                ))}
                <div>
                  <span>Cash reserve</span>
                  <strong>
                    {usd(String((BigInt(paper.budget) * 30n) / 100n))}
                  </strong>
                </div>
              </div>
              <p>
                5% per entry / 10% per event / $5 minimum entry / 5% maximum
                entry-price increase / skip signals older than two minutes.
                Pause new entries at 10% realized loss; open positions can still
                lose.
              </p>
            </section>
            <section className="paper-card">
              <h2>
                Paper positions{" "}
                <span className="beta">{active.length} OPEN</span>
              </h2>
              {paper.positions.length === 0 ? (
                <p className="paper-empty">
                  Waiting for a new trade from your selected wallets. Previous
                  trades are never copied retroactively.
                </p>
              ) : (
                paper.positions.map((pos) => (
                  <div className="paper-position" key={pos.id}>
                    <div>
                      <strong>{pos.title}</strong>
                      <p>
                        {pos.side.toUpperCase()} / {short(pos.owner)} /{" "}
                        {pos.settled ? "Settled" : "Hypothetical entry"}
                      </p>
                    </div>
                    <div>
                      <strong>{usd(pos.cost)}</strong>
                      <p>
                        entry {usd(pos.entry)} / contract
                        {pos.settled
                          ? " / payout " + usd(pos.payout ?? "0")
                          : ""}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </section>
            <section className="paper-card">
              <h2>Decision receipts</h2>
              {paper.journal.length === 0 ? (
                <p>
                  No decisions yet. Observation is active while this page is
                  open.
                </p>
              ) : (
                paper.journal.map((x) => (
                  <div className="paper-receipt" key={x.id}>
                    <span className="beta">{x.decision}</span>
                    <div>
                      <strong>{x.title}</strong>
                      <p>{x.reason}</p>
                      <small>{new Date(x.at).toLocaleString()}</small>
                    </div>
                  </div>
                ))
              )}
              <button
                className="text-button"
                onClick={() => {
                  if (
                    confirm(
                      "Delete this virtual portfolio and its local receipts?",
                    )
                  ) {
                    localStorage.removeItem(storageKey);
                    current.current = null;
                    setPaper(null);
                    setSelected([]);
                  }
                }}
              >
                Reset virtual portfolio
              </button>
            </section>
          </>
        )}
        <section className="paper-card">
          <h2>Recent public activity</h2>
          <p>
            {feed?.coverage ?? "Live data is loading."} Updates may miss trades
            during busy periods, outages, or when the tab is closed.
          </p>
          {feed?.trades.slice(0, 8).map((t) => (
            <div className="paper-position" key={t.id}>
              <div>
                <strong>
                  {t.eventTitle} / {t.marketTitle}
                </strong>
                <p>
                  {short(t.ownerPubkey)} / {t.action} {t.side.toUpperCase()} /{" "}
                  {new Date(Number(t.timestamp) * 1000).toLocaleTimeString()}
                </p>
              </div>
              <strong>{usd(t.amountUsd)}</strong>
            </div>
          ))}
          <small>
            {feed
              ? "Last retrieval: " + new Date(feed.retrievedAt).toLocaleString()
              : "No live data retrieved yet."}{" "}
            / Portfolio saved in this browser only.
          </small>
        </section>
      </main>
    </>
  );
}
