"use client";
import { AppHeader } from "@/components/app-header";
import { useCallback, useEffect, useState, useRef } from "react";
import { AccountConnection } from "../../account/components/account-connection";
import type { Feed } from "@/features/prediction-bot/market-feeds";
import type { MarketPoint } from "@/features/prediction-bot/market-recorder";
import type { StrategyResult } from "@/features/prediction-bot/strategy-lab";
type Snapshot = {
  feeds: (Pick<Feed, "source" | "at" | "error"> & { count: number })[];
  markets: MarketPoint[];
  observations: number;
  firstAt: number | null;
  lastAt: number | null;
  strategies: StrategyResult[];
  collectorEnabled: boolean;
  qualification: string;
  coverage: string;
  bot: { budget: string; strategy: string; watching: boolean } | null;
  signedIn: boolean;
};
const time = (n: number | null) =>
  n ? new Date(n).toLocaleString() : "Waiting for the first sample";
const price = (p: string | null) =>
  p === null ? "Unavailable" : `${(Number(p) / 10000).toFixed(2)}¢`;
export function BotWorkspace() {
  const previousPlan = useRef<string | null>(null);
  const requestSequence = useRef(0);
  const [data, setData] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [budget, setBudget] = useState("100"),
    [checkedAt, setCheckedAt] = useState(0),
    [strategy, setStrategy] = useState("Momentum"),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    try {
      const r = await fetch("/api/bot", {
          cache: "no-store",
          signal: AbortSignal.timeout(12000),
        }),
        j = await r.json();
      if (sequence !== requestSequence.current) return;
      if (!r.ok) throw Error(j.error?.message ?? "Could not load market data.");
      setData(j);
      setCheckedAt(Date.now());
      const serialized = JSON.stringify(j.bot ?? null);
      if (serialized !== previousPlan.current) {
        previousPlan.current = serialized;
        if (j.bot) {
          setBudget(j.bot.budget);
          setStrategy(j.bot.strategy);
        } else {
          setBudget("100");
          setStrategy("Momentum");
        }
      }
      setError("");
    } catch (e) {
      if (sequence !== requestSequence.current) return;
      setError(e instanceof Error ? e.message : "Market data unavailable.");
    }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const interval = setInterval(() => void refresh(), 15000);
    window.addEventListener("exitcheck-account", refresh);
    return () => {
      clearInterval(interval);
      clearTimeout(initial);
      window.removeEventListener("exitcheck-account", refresh);
    };
  }, [refresh]);
  async function save(watching: boolean) {
    setBusy(true);
    try {
      const r = await fetch("/api/bot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            budget: !watching && data?.bot ? data.bot.budget : budget,
            strategy: !watching && data?.bot ? data.bot.strategy : strategy,
            watching,
          }),
        }),
        j = await r.json();
      if (!r.ok)
        throw Error(j.error?.message ?? "Could not save bot settings.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <AppHeader />
      <main className="paper-main bot-main">
        <AccountConnection />
        <div className="paper-intro">
          <p className="eyebrow">PREDICTION MARKETS · RESEARCH MODE</p>
          <h1>
            Your bot starts
            <br />
            with better evidence.
          </h1>
          <p>
            Watch real markets, compare simple rules, and understand why the bot
            acts or waits. Execution stays on Solana when it becomes available.
          </p>
        </div>
        <div className="paper-notice">
          <strong>Collecting evidence. Funded trading is disabled.</strong>
          <p>
            {data?.qualification ?? "Loading recorder status…"} No virtual fills
            or returns are invented.
          </p>
        </div>
        {error && (
          <p className="paper-error" role="alert">
            {error}
          </p>
        )}
        <section className="bot-feed-grid" aria-label="Data sources">
          {(["jupiter", "polymarket", "kalshi"] as const).map((source) => {
            const f = data?.feeds.find((x) => x.source === source),
              fresh = !!f && checkedAt - f.at < 120000;
            return (
              <article className="paper-card" key={source}>
                <p className="eyebrow">
                  {source === "jupiter"
                    ? "SOLANA ROUTE DATA"
                    : "EXTERNAL MARKET DATA"}
                </p>
                <h2>
                  {source === "jupiter"
                    ? "Jupiter"
                    : source === "polymarket"
                      ? "Polymarket"
                      : "Kalshi"}
                </h2>
                <span className="bot-status">
                  {!f
                    ? "Waiting"
                    : f.error
                      ? "Unavailable"
                      : !fresh
                        ? "Stale"
                        : "Connected"}
                </span>
                <p>
                  {f?.error ??
                    `${f?.count ?? 0} markets in the latest public sample`}
                </p>
                <small>Last request: {time(f?.at ?? null)}</small>
              </article>
            );
          })}
        </section>
        <section className="paper-card">
          <p className="eyebrow">MY BOT · SIGNAL WATCHING</p>
          <h2>
            {data?.bot?.watching
              ? "Watching for evidence"
              : "Set your paper plan"}
          </h2>
          <p>
            Save a virtual budget and a rule. Market recording continues while
            this server is online, even with the browser closed. Entries remain
            blocked until execution data is verified.
          </p>
          <div className="bot-plan">
            <label>
              Virtual budget (USD)
              <input
                value={budget}
                inputMode="decimal"
                onChange={(e) => setBudget(e.target.value)}
                aria-label="Virtual budget"
              />
            </label>
            <label>
              Rule
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
              >
                <option>Momentum</option>
                <option>Price divergence</option>
                <option>No trade</option>
              </select>
            </label>
            <button
              disabled={busy || !data?.signedIn}
              onClick={() => void save(true)}
            >
              Save &amp; watch
            </button>
            {data?.bot && (
              <button disabled={busy} onClick={() => void save(false)}>
                Pause watching
              </button>
            )}
          </div>
          {!data?.signedIn && (
            <p>
              Connect your wallet and sign in above to save your plan. No
              transaction signature is requested.
            </p>
          )}
          {data?.bot && (
            <p>
              <strong>
                ${data.bot.budget} virtual cash · {data.bot.strategy} ·{" "}
                {data.bot.watching ? "Watching" : "Paused"}
              </strong>
              <br />0 entries executed. Cash is unchanged because fills and fees
              are unverified.
            </p>
          )}
        </section>
        <section className="paper-card">
          <p className="eyebrow">STRATEGY LAB</p>
          <h2>Compare rules before committing money</h2>
          <p>
            {data?.observations ?? 0} recorded route observations · Since{" "}
            {time(data?.firstAt ?? null)}
          </p>
          <div className="bot-strategies">
            {data?.strategies.map((s) => (
              <article key={s.strategy}>
                <h3>{s.strategy}</h3>
                <p className="bot-metric">
                  {s.signals}
                  <small> qualifying signals</small>
                </p>
                <p>{s.reason}</p>
                <small>
                  {s.observations} observations · No validated winner
                </small>
              </article>
            ))}
          </div>
          <p className="bot-muted">
            Signals are research counts, not trades or profit. Thresholds are
            fixed: momentum +3 percentage points within 90 seconds; independent
            price divergence +5 points. Missing data blocks entries.
            Unseen-period testing has not been completed.
          </p>
        </section>
        <section className="paper-card">
          <p className="eyebrow">TRACKED SOLANA MARKETS</p>
          <h2>See the evidence behind every wait</h2>
          {!data?.markets.length ? (
            <p>
              No future crypto routes recorded yet. Waiting for a valid live
              sample; demo markets are never substituted.
            </p>
          ) : (
            <div className="bot-markets">
              {data.markets.map((p) => (
                <article key={p.route.id}>
                  <h3>{p.route.title}</h3>
                  <p>
                    <span className="bot-status">
                      {p.verified ? "Underlying verified" : "Entry blocked"}
                    </span>
                  </p>
                  <div className="bot-prices">
                    <span>
                      Solana indicative bid{" "}
                      <strong>{price(p.route.bid)}</strong>
                    </span>
                    <span>
                      Solana indicative ask{" "}
                      <strong>{price(p.route.ask)}</strong>
                    </span>
                  </div>
                  <p>{p.reason}</p>
                  <small>
                    {p.route.id} · Observed {time(p.at)}
                  </small>
                  <details>
                    <summary>Outcome and settlement rules</summary>
                    <p>Selected outcome: {p.route.outcome ?? "Unverified"}</p>
                    <p>{p.route.rules || "Rules unavailable"}</p>
                    <p>Route close time: {time(p.route.closesAt)}</p>
                  </details>
                </article>
              ))}
            </div>
          )}
          <p className="bot-muted">{data?.coverage}</p>
          {data && !data.collectorEnabled && (
            <p className="paper-error">
              Background collector is disabled. Start the production server with
              npm start to record continuously.
            </p>
          )}
        </section>
      </main>
    </>
  );
}
