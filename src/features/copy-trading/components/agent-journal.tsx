"use client";
import { money } from "@/lib/amounts";
import type { AgentJournalEntry } from "../agent-journal";
import styles from "./agent.module.css";
export function AgentJournal({ entries }: { entries: AgentJournalEntry[] }) {
  return (
    <section className={styles.journal} aria-labelledby="journal-heading">
      <p className="eyebrow">YOUR SAVED EVIDENCE</p>
      <h2 id="journal-heading">Decision journal</h2>
      <p className={styles.note}>
        Reviews are historical snapshots. They do not authorize trades or prove
        fills. Latest 50 reviews, including previous plans.
      </p>
      {entries.length ? (
        entries.map((item) => (
          <details className={styles.journalItem} key={item.id}>
            <summary>
              {item.decision.title} · {item.decision.side.toUpperCase()} ·{" "}
              {new Date(item.review.checkedAt).toLocaleString()}
            </summary>
            <p>
              <strong>No agent trade executed</strong>
            </p>
            <dl className={styles.checkFacts}>
              <div>
                <dt>Planned entry</dt>
                <dd>{money(item.decision.allocation)}</dd>
              </div>
              <div>
                <dt>Trader fill price</dt>
                <dd>{money(item.decision.leaderPrice, 4)}</dd>
              </div>
              <div>
                <dt>Observed quote</dt>
                <dd>{money(item.review.entry.quotePrice, 4)}</dd>
              </div>
              <div>
                <dt>Observed exit proceeds before fees</dt>
                <dd>{money(item.review.exit.estimate?.gross ?? null)}</dd>
              </div>
              <div>
                <dt>Price check at review</dt>
                <dd>{item.review.entry.status.replaceAll("_", " ")}</dd>
              </div>
              <div>
                <dt>Wallet check at review</dt>
                <dd>
                  {item.review.wallet?.status.replaceAll("_", " ") ?? "unknown"}
                </dd>
              </div>
            </dl>
            <p>{item.decision.reason}</p>
            <p>{item.review.entry.reason}</p>
            <p>{item.review.wallet?.reason}</p>
            <p>{item.review.exit.reason}</p>
            <p className={styles.note}>
              Source event {item.decision.sourceId}; detected{" "}
              {new Date(item.decision.observedAt).toLocaleString()}. Recorded
              proposal state: {item.decision.status}. Snapshot validity ended{" "}
              {new Date(item.review.expiresAt).toLocaleString()}. Fees and net
              proceeds were not verified.
            </p>
          </details>
        ))
      ) : (
        <p className={styles.note}>
          Check a fresh proposal’s price and exit depth to save your first
          review. Skips and detected exits remain in Agent activity above.
        </p>
      )}
    </section>
  );
}
