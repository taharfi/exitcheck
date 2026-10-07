"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { decimalToMicro, money } from "@/lib/amounts";
type Report = {
  owner: string;
  budget: string;
  observedBuys: number;
  observedSells: number;
  uniqueBuyEvents: number;
  medianLeaderBuy: string | null;
  proposedEntry: string;
  assessment: string;
  coverage: { events: number; complete: boolean; stopReason: string };
  prospective: {
    observedBuys: number;
    withIndicativeQuote: number;
    withinTwoMinutes: number;
  };
  warning: string;
};
export function CopyabilityPanel({
  owner,
  budget = "100",
}: {
  owner: string;
  budget?: string;
}) {
  const [report, setReport] = useState<Report | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  async function load() {
    const id = ++generation.current;
    setBusy(true);
    setError("");
    setReport(null);
    try {
      const q = new URLSearchParams({
        owner,
        budget: decimalToMicro(budget).toString(),
      });
      const r = await fetch("/api/copyability?" + q, {
          cache: "no-store",
          signal: AbortSignal.timeout(120000),
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error?.message ?? "Report unavailable.");
      if (id === generation.current) setReport(j);
    } catch (e) {
      if (id === generation.current)
        setError(e instanceof Error ? e.message : "Report unavailable.");
    } finally {
      if (id === generation.current) setBusy(false);
    }
  }
  return (
    <section className="copyability-panel">
      <p className="eyebrow">BEYOND THE LEADERBOARD</p>
      <h3>Can you realistically follow this wallet?</h3>
      <p>
        Inspect the retrieved trade sample and evidence from background
        observation. No score or promised return.
      </p>
      <button
        className="paper-primary"
        disabled={busy}
        onClick={() => void load()}
      >
        {busy ? "Inspecting trade history..." : "Build copyability report"}
      </button>
      {error && (
        <p role="alert" className="paper-error">
          {error}
        </p>
      )}
      {report && report.owner === owner && (
        <>
          <div className="discover-profile-stats">
            <div>
              <span>Observed buys / sells</span>
              <strong>
                {report.observedBuys} / {report.observedSells}
              </strong>
            </div>
            <div>
              <span>Median leader buy, retrieved sample</span>
              <strong>
                {report.medianLeaderBuy === null
                  ? "Unknown"
                  : money(report.medianLeaderBuy)}
              </strong>
            </div>
            <div>
              <span>Your proposed 5% entry</span>
              <strong>{money(report.proposedEntry)}</strong>
              <small>Starting budget {money(report.budget)}</small>
            </div>
            <div>
              <span>Distinct buy events</span>
              <strong>{report.uniqueBuyEvents}</strong>
            </div>
          </div>
          <p className="paper-notice">
            {report.assessment} {report.coverage.events} events imported.{" "}
            {report.coverage.stopReason}
          </p>
          <div className="evidence-grid">
            <div>
              <strong>{report.prospective.observedBuys}</strong>
              <span>Prospectively observed buy signals</span>
            </div>
            <div>
              <strong>{report.prospective.withIndicativeQuote}</strong>
              <span>With a fresh indicative entry quote</span>
            </div>
            <div>
              <strong>{report.prospective.withinTwoMinutes}</strong>
              <span>Detected within two minutes</span>
            </div>
          </div>
          <p>
            {report.prospective.observedBuys === 0
              ? "No prospective observations yet. Start a shadow portfolio to collect evidence. "
              : ""}
            {report.warning}
          </p>
          <Link
            href={"/shadow?owner=" + owner + "&budget=" + report.budget}
            className="paper-primary discover-follow"
          >
            Observe with a shadow portfolio
          </Link>
        </>
      )}
    </section>
  );
}
