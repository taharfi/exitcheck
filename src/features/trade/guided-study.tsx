import { useState } from "react";
import type { MarketItem } from "./types";
import styles from "./terminal.module.css";
export function GuidedStudy({
  market,
  positions,
  results,
}: {
  market?: MarketItem;
  positions: number;
  results: number;
}) {
  const [step, setStep] = useState(0);
  const stages = [
    {
      name: "Understand",
      target: "paper-order",
      text: "Choose a live market. Read its original resolution rules, compare the research and inspect the exit estimate. Wait when evidence is missing.",
    },
    {
      name: "Practice",
      target: "paper-order",
      text: "Set your paper quantity and limit, review maximum loss and approve only the simulation you intend. No wallet or real funds are needed.",
    },
    {
      name: "Review",
      target: "paper-journal",
      text: "Preview the close against current bids or check a verified result. Record your paper action, review the receipt and export the journal. If depth or resolution is missing, the position stays open.",
    },
  ];
  return (
    <section className={styles.tradeCheck} aria-label="Guided case study">
      <div className={styles.sectionHeading}>
        <h2>Understand → Practice → Review</h2>
        <span className={styles.live}>LIVE CASE STUDY</span>
      </div>
      <p className={styles.notice}>
        Use your selected real market as the case. Results appear only after
        your own paper actions.
      </p>
      <p>
        <strong>{market?.question ?? "Choose a live market to begin"}</strong>
      </p>
      <div className={styles.journalActions}>
        {stages.map((s, i) => (
          <button
            key={s.name}
            aria-pressed={step === i}
            onClick={() => setStep(i)}
          >
            {i + 1}. {s.name}
          </button>
        ))}
      </div>
      <p>{stages[step].text}</p>
      <p className={styles.notice}>
        {positions} open paper holdings · {results} recorded exits or
        settlements. These counts describe your browser journal, not strategy
        profitability.
      </p>
      <button
        className={styles.checkExit}
        disabled={!market}
        onClick={() => {
          const target = document.getElementById(stages[step].target);
          const drawer = target?.closest("details");
          if (drawer) drawer.open = true;
          target?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      >
        Go to {stages[step].name.toLowerCase()}
      </button>
    </section>
  );
}
