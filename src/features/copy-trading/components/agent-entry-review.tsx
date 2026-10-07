"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { decimal, money } from "@/lib/amounts";
import type { AgentEntryReview as Review } from "../agent-review";
import { summarizeAgentReview } from "../agent-review-summary";
import styles from "./agent.module.css";

const percent = (basisPoints: string) => {
  const value = BigInt(basisPoints),
    absolute = value < 0n ? -value : value;
  return `${value < 0n ? "−" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}%`;
};
const solAmount = (lamports: string) => {
  const n = BigInt(lamports);
  return `${n / 1000000000n}.${(n % 1000000000n).toString().padStart(9, "0")} SOL`;
};
export function AgentEntryReview({
  planId,
  decisionId,
  checkedAt,
  onSaved,
}: {
  planId: string;
  decisionId: string;
  checkedAt: number;
  onSaved?: () => void;
}) {
  const [report, setReport] = useState<Review | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [now, setNow] = useState(checkedAt);
  const [depositAsset, setDepositAsset] = useState<"USDC" | "JupUSD">("USDC");
  const abort = useRef<AbortController | null>(null),
    generation = useRef(0);
  const cancel = useCallback(() => {
    generation.current++;
    abort.current?.abort();
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancel();
      clearInterval(timer);
    };
  }, [cancel]);
  async function check() {
    if (abort.current) return;
    const sequence = ++generation.current,
      controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError("");
    setReport(null);
    try {
      const response = await fetch("/api/agent/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, decisionId, depositAsset }),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(45000),
        ]),
      });
      const data = await response.json();
      if (!response.ok)
        throw Error(data.error?.message ?? "The entry check is unavailable.");
      if (!controller.signal.aborted && sequence === generation.current) {
        setReport(data);
        onSaved?.();
      }
    } catch (e) {
      if (!controller.signal.aborted && sequence === generation.current)
        setError(
          e instanceof Error ? e.message : "The entry check is unavailable.",
        );
    } finally {
      if (!controller.signal.aborted && sequence === generation.current) {
        setBusy(false);
        abort.current = null;
      }
    }
  }
  const stale = !!report && Math.max(checkedAt, now) >= report.expiresAt;
  const summary = report
    ? summarizeAgentReview(report, Math.max(checkedAt, now))
    : null;
  return (
    <section
      className={styles.entryReview}
      aria-label="Entry price and exit check"
    >
      <div className={styles.checkHeading}>
        <strong>Before you copy</strong>
        <button type="button" disabled={busy} onClick={() => void check()}>
          {busy
            ? "Checking…"
            : report
              ? "Refresh entry check"
              : "Check price & exit"}
        </button>
      </div>
      <label className={styles.assetChoice}>
        Planning deposit token
        <select
          value={depositAsset}
          disabled={busy}
          onChange={(event) => {
            setDepositAsset(event.target.value as "USDC" | "JupUSD");
            setReport(null);
            setError("");
          }}
        >
          <option value="USDC">USDC</option>
          <option value="JupUSD">JupUSD</option>
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {report && (
        <>
          {summary && (
            <p
              className={styles.checkReason}
              data-state={summary.status === "blocked" ? "blocked" : "unknown"}
              role="status"
            >
              <strong>{summary.title}</strong>
              <br />
              {summary.reason}
            </p>
          )}
          <p className={styles.checkTime}>
            {stale
              ? "Snapshot expired. Refresh before using these estimates."
              : `Checked ${new Date(report.checkedAt).toLocaleTimeString()}. Snapshot only; no trade authorized.`}
          </p>
          <dl className={styles.checkFacts}>
            <div>
              <dt>Source detection delay</dt>
              <dd>{Math.ceil(report.sourceDelayMs / 1000)} seconds</dd>
            </div>
            <div>
              <dt>Market closes</dt>
              <dd>
                {report.market
                  ? new Date(report.market.closesAt).toLocaleString()
                  : "Not verified"}
              </dd>
            </div>
            <div>
              <dt>Quote versus trader fill</dt>
              <dd>
                {stale || report.entry.differenceBps === null
                  ? "Not verified"
                  : percent(report.entry.differenceBps)}
              </dd>
            </div>
            <div>
              <dt>Hypothetical entry size</dt>
              <dd>
                {stale || report.entry.hypotheticalContracts === null
                  ? "Not verified"
                  : `${decimal(report.entry.hypotheticalContracts, 4)} contracts`}
              </dd>
            </div>
          </dl>
          <p
            className={styles.checkReason}
            data-state={stale ? "unknown" : report.entry.status}
          >
            <strong>
              {stale
                ? "Refresh required"
                : report.entry.status === "within_limit"
                  ? "Price within planning limit"
                  : report.entry.status === "blocked"
                    ? "Entry blocked by current checks"
                    : "Entry price not fully verified"}
            </strong>
            <br />
            {stale
              ? "This is a historical check. The current price must be retrieved again."
              : report.entry.reason}
          </p>
          <div className={styles.exitCheck}>
            <strong>Wallet &amp; budget check</strong>
            <p
              className={styles.checkReason}
              data-state={stale ? "unknown" : report.wallet?.status}
            >
              <strong>
                {stale
                  ? "Refresh required"
                  : report.wallet?.status === "blocked"
                    ? "Wallet checks blocked this entry"
                    : report.wallet?.status === "within_budget"
                      ? "Within budget before fees"
                      : "Wallet check incomplete"}
              </strong>
            </p>
            <dl className={styles.checkFacts}>
              <div>
                <dt>
                  Available {report.wallet?.selectedAsset ?? depositAsset}
                </dt>
                <dd>
                  {stale
                    ? "Not verified"
                    : report.wallet?.funds?.balances[
                          report.wallet.selectedAsset
                        ] === null || !report.wallet?.funds
                      ? "Not verified"
                      : `${decimal(report.wallet.funds.balances[report.wallet.selectedAsset]!)} ${report.wallet.selectedAsset}`}
                </dd>
              </div>
              <div>
                <dt>Held cost in this event</dt>
                <dd>
                  {stale
                    ? "Not verified"
                    : money(report.wallet?.exposure?.eventCost ?? null)}
                </dd>
              </div>
              <div>
                <dt>Remaining planning allocation</dt>
                <dd>
                  {stale
                    ? "Not verified"
                    : money(report.wallet?.remainingBudget ?? null)}
                </dd>
              </div>
              <div>
                <dt>Trading &amp; network fees</dt>
                <dd>Not verified</dd>
              </div>
            </dl>
            <p role="status">
              {stale
                ? "Refresh to check wallet funds and positions again."
                : (report.wallet?.reason ??
                  "Wallet funds and positions were not verified in this snapshot.")}
            </p>
            <details className={styles.source}>
              <summary>More wallet details</summary>
              <dl className={styles.checkFacts}>
                <div>
                  <dt>USDC balance</dt>
                  <dd>
                    {stale || report.wallet?.funds?.balances.USDC == null
                      ? "Not verified"
                      : `${decimal(report.wallet.funds.balances.USDC)} USDC`}
                  </dd>
                </div>
                <div>
                  <dt>JupUSD balance</dt>
                  <dd>
                    {stale || report.wallet?.funds?.balances.JupUSD == null
                      ? "Not verified"
                      : `${decimal(report.wallet.funds.balances.JupUSD)} JupUSD`}
                  </dd>
                </div>
                <div>
                  <dt>SOL for network costs</dt>
                  <dd>
                    {stale || !report.wallet?.funds?.solLamports
                      ? "Not verified"
                      : solAmount(report.wallet.funds.solLamports)}
                  </dd>
                </div>
                <div>
                  <dt>All held prediction position cost</dt>
                  <dd>
                    {stale
                      ? "Not verified"
                      : money(report.wallet?.exposure?.heldCost ?? null)}
                  </dd>
                </div>
                <div>
                  <dt>Remaining event allocation</dt>
                  <dd>
                    {stale
                      ? "Not verified"
                      : money(report.wallet?.remainingEventBudget ?? null)}
                  </dd>
                </div>
              </dl>
              <p>
                Balances exclude frozen and delegated token accounts. Held cost
                is provider-reported cost basis, not current value or worst-case
                loss. Tokens are not combined; the selected token is{" "}
                {report.wallet?.selectedAsset ?? depositAsset}.
              </p>
            </details>
          </div>
          <div className={styles.exitCheck}>
            <strong>Could this size exit at current bids?</strong>
            <div className={styles.prices}>
              <div>
                <span>Bid coverage</span>
                <strong>
                  {stale || report.exit.coverageBps === null
                    ? "Not verified"
                    : percent(report.exit.coverageBps)}
                </strong>
              </div>
              <div>
                <span>Estimated proceeds before fees</span>
                <strong>
                  {stale
                    ? "Not verified"
                    : money(report.exit.estimate?.gross ?? null)}
                </strong>
              </div>
            </div>
            <p>
              {stale
                ? "The bid snapshot is no longer current. Refresh to check available exit liquidity."
                : report.exit.reason}
            </p>
          </div>
          <p className={styles.checkTime}>
            The size assumes entry at the indicative quote before fees. Market
            close is not a guaranteed settlement time. Buy execution, fees, rent
            and final transaction limits remain unverified. This review is saved
            in your private decision journal.
          </p>
        </>
      )}
      {!report && !error && (
        <p className={styles.checkTime}>
          Refresh the quote and inspect same-side bids for your planned size.
          Fees and future liquidity are unknown.
        </p>
      )}
    </section>
  );
}
