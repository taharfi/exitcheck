"use client";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { AppHeader } from "@/components/app-header";
const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function OverviewWorkspace() {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const [budget, setBudget] = useState("100");
  const valid =
    /^\d+(\.\d{1,2})?$/.test(budget) &&
    Number(budget) >= 100 &&
    Number(budget) <= 1_000_000;
  return (
    <>
      <AppHeader />
      <main className="paper-main overview-main">
        <div className="overview-heading">
          <span className="eyebrow">YOUR COPY-TRADING WORKSPACE</span>
          <span className="overview-mode">
            Virtual funds · Public wallet data
          </span>
        </div>
        <section className="overview-hero">
          <div>
            <p className="eyebrow">A WINNING WALLET IS ONLY THE START</p>
            <h1>
              Would copying them
              <br />
              work for you?
            </h1>
            <p>
              Find Solana prediction traders, test them with your budget, and
              observe what happens next before committing funds.
            </p>
            <Link className="paper-primary" href="/discover">
              Find traders <span aria-hidden="true">↗</span>
            </Link>
            <small>No wallet connection needed to explore.</small>
          </div>
          <div className="overview-budget">
            <span className="eyebrow">START WITH YOUR BUDGET</span>
            <h2>Make it personal.</h2>
            <p>
              See how capital limits, modeled costs and overlapping markets
              affect a historical replay.
            </p>
            <label htmlFor="starting-budget">Virtual budget (USD)</label>
            <div className="overview-amount">
              <span aria-hidden="true">$</span>
            <input
              disabled={!ready}
                id="starting-budget"
                inputMode="decimal"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                aria-describedby="budget-help"
              />
            </div>
            <div className="overview-presets">
              {["100", "500", "1000"].map((value) => (
              <button
                disabled={!ready}
                  key={value}
                  onClick={() => setBudget(value)}
                  aria-pressed={budget === value}
                >
                  ${Number(value).toLocaleString("en-US")}
                </button>
              ))}
            </div>
            <p id="budget-help">
              {valid
                ? "Choose up to three wallets on the next screen."
                : "Enter $100–$1,000,000 with up to two decimal places."}
            </p>
            {valid ? (
              <Link
                className="paper-primary"
                href={"/compare?budget=" + encodeURIComponent(budget)}
              >
                Test my budget <span aria-hidden="true">→</span>
              </Link>
            ) : (
              <button className="paper-primary" disabled>
                Test my budget
              </button>
            )}
            <small>Historical scenarios. Future returns are unknown.</small>
          </div>
        </section>
        <section className="overview-journey" aria-label="Your next steps">
          <Link href="/discover">
            <span className="journey-number">01</span>
            <h2>Find traders</h2>
            <p>
              Review public performance and available history. Save a shortlist
              instead of choosing on profit alone.
            </p>
            <strong>Explore wallets →</strong>
          </Link>
          <Link href="/compare">
            <span className="journey-number">02</span>
            <h2>Test your budget</h2>
            <p>
              Replay a shared budget. Check skipped trades, open exposure and
              overlap between wallets.
            </p>
            <strong>Compare scenarios →</strong>
          </Link>
          <Link href="/shadow">
            <span className="journey-number">03</span>
            <h2>Observe first</h2>
            <p>
              Start a seven-day virtual observation. Review collected activity
              and data gaps as they happen.
            </p>
            <strong>Open my observation →</strong>
          </Link>
        </section>
        <section className="overview-evidence">
          <div>
            <span className="eyebrow">WHAT YOU CAN TRUST HERE</span>
            <h2>See the limits alongside the results.</h2>
          </div>
          <p>
            Public rankings describe the source trader. Replays model your
            budget and costs. Observation uses indicative quotes; it does not
            prove executable fills. Missing history and unvalued open positions
            remain visible.
          </p>
          <Link href="/lab">Explore advanced research →</Link>
        </section>
      </main>
    </>
  );
}
