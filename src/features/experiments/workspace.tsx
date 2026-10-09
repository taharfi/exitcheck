"use client";
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { AccountConnection } from "@/features/account/components/account-connection";
import { parseRequest, type Experiment, type Plan } from "./engine";
import styles from "./workspace.module.css";
export function ExperimentWorkspace() {
  const [text, setText] = useState("Test $300 across 3 strategies for 7 days"),
    [plan, setPlan] = useState<Plan | null>(null),
    [items, setItems] = useState<Experiment[]>([]),
    [signedIn, setSignedIn] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/experiments");
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error?.message ?? "Could not load experiments.");
      setItems(data.experiments);
      setSignedIn(data.signedIn);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load experiments.");
    }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const reload = () => {
      setItems([]);
      void load();
    };
    window.addEventListener("exitcheck-account", reload);
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener("exitcheck-account", reload);
    };
  }, [load]);
  async function act(input: object) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error?.message ?? "Could not save experiment.");
      setPlan(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <AppHeader actions={<AccountConnection context="experiments" />} />
      <main className={styles.main}>
        <p className={styles.eyebrow}>PAPER EXPERIMENTS</p>
        <h1>One budget. Three strategies.</h1>
        <p>
          Create a private, saved experiment. Compare observed results before
          risking funds.
        </p>
        <section className={styles.card}>
          <label htmlFor="request">What would you like to test?</label>
          <textarea
            id="request"
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            onClick={() => {
              try {
                setPlan(parseRequest(text));
                setError("");
              } catch {
                setPlan(null);
                setError(
                  "Include a budget from $30 to $10,000 and a duration from 1 to 30 days. Example: Test $300 for 7 days.",
                );
              }
            }}
          >
            Preview plan
          </button>
          <p>
            Supports budget and duration requests. Three fixed templates; no AI
            call or real orders.
          </p>
          {plan && (
            <div className={styles.preview}>
              <h2>
                ${plan.budget.toFixed(2)} for {plan.days} days
              </h2>
              <p>
                Equal allocation across market baseline, evidence threshold and
                liquidity filter. Up to three YES positions per strategy, up to
                20% of its initial allocation per entry. Assumed slippage:
                0.05%; fees excluded.
              </p>
              <p>
                Baseline buys the highest-volume eligible market. Liquidity
                filter additionally requires $10,000 reported liquidity.
                Evidence strategy stays in cash until independent research is
                connected.
              </p>
              <button
                disabled={busy || !signedIn}
                onClick={() =>
                  void act({ action: "create", plan, approved: true })
                }
              >
                Approve & start paper experiment
              </button>
              {!signedIn && (
                <p>
                  Connect and sign in above to save. Your funds are never used.
                </p>
              )}
            </div>
          )}
        </section>
        {error && <p role="alert">{error}</p>}
        <div className={styles.notes}>
          <div>
            <strong>You control each check</strong>
            <p>
              Press Check live markets to record fresh observations. Background
              checks are not enabled.
            </p>
          </div>
          <div>
            <strong>Paper results only</strong>
            <p>
              Positions remain marked and unsettled when an experiment ends. No
              real orders.
            </p>
          </div>
          <div>
            <strong>Private to your wallet</strong>
            <p>
              Sign in to save and reopen your experiments on another browser.
            </p>
          </div>
        </div>
        {items.length === 0 && (
          <section className={styles.empty}>
            <h2>Your experiments will appear here</h2>
            <p>
              Preview a plan above, then sign in and approve it to start
              comparing strategies.
            </p>
          </section>
        )}
        {items.map((exp) => (
          <section key={exp.id} className={styles.card}>
            <h2>
              ${exp.plan.budget.toFixed(2)} / {exp.plan.days} days
            </h2>
            <p>
              {exp.complete
                ? "Ended (marked, unsettled)"
                : exp.paused
                  ? "Paused"
                  : "Active"}{" "}
              / Last check:{" "}
              {exp.updatedAt
                ? new Date(exp.updatedAt).toLocaleString()
                : "Not checked"}
            </p>
            <button
              disabled={busy || exp.paused || exp.complete}
              onClick={() => void act({ action: "check", id: exp.id })}
            >
              Check live markets
            </button>{" "}
            <button
              disabled={busy || exp.complete}
              onClick={() =>
                void act({
                  action: exp.paused ? "resume" : "pause",
                  id: exp.id,
                })
              }
            >
              {exp.paused ? "Resume" : "Pause"}
            </button>
            <div className={styles.grid}>
              {exp.strategies.map((s, i) => {
                const equity =
                  s.cash +
                  s.positions.reduce((n, p) => n + p.shares * p.mark, 0);
                const cents = Math.round(exp.plan.budget * 100),
                  base = Math.floor(cents / 3),
                  initial = (base + (i === 2 ? cents - base * 3 : 0)) / 100;
                return (
                  <article key={s.name}>
                    <h3>{s.name}</h3>
                    <p>
                      Equity ${equity.toFixed(2)} / Change $
                      {(equity - initial).toFixed(2)}
                    </p>
                    <p>
                      Cash ${s.cash.toFixed(2)} / Max observed drawdown $
                      {s.drawdown.toFixed(2)}
                    </p>
                    {s.decisions.map((d, i) => (
                      <p key={i}>{d}</p>
                    ))}
                    {s.positions.map((p) => (
                      <p key={p.marketId}>
                        {p.question}
                        <br />
                        {p.shares.toFixed(2)} shares / Entry{" "}
                        {(p.entry * 100).toFixed(1)} cents / Mark{" "}
                        {(p.mark * 100).toFixed(1)} cents{" "}
                        {p.stale ? "(stale)" : ""}
                      </p>
                    ))}
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </main>
    </>
  );
}
