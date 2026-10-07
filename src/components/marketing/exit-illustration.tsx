"use client";

import { useState } from "react";
import { BrandMark } from "@/components/brand";
import styles from "./landing.module.css";

const scenarios = [
  { size: 25, proceeds: "16.00", price: "0.640" },
  { size: 50, proceeds: "31.50", price: "0.630" },
  { size: 100, proceeds: "60.50", price: "0.605" },
] as const;

// Illustrative bids: 25 contracts each at $0.64, $0.62, $0.60 and $0.56.
// These are educational scenarios, never a provider quote or execution promise.
export function ExitIllustration() {
  const [selected, setSelected] = useState<(typeof scenarios)[number]>(
    scenarios[2],
  );
  return (
    <div
      className={styles.preview}
      aria-label="Interactive example exit estimate"
    >
      <div className={styles.previewBar}>
        <span>
          <BrandMark className={styles.miniMark} /> ExitCheck{" "}
          <span className={styles.previewDivider}>/</span> Exit preview
        </span>
        <span className={styles.exampleBadge}>Illustrative example</span>
      </div>
      <div className={styles.previewBody}>
        <div className={styles.marketRow}>
          <div>
            <span className={styles.microLabel}>YOUR POSITION</span>
            <h3>Example prediction market</h3>
          </div>
          <span className={styles.outcome}>YES</span>
        </div>
        <div className={styles.positionFacts}>
          <div>
            <span>Contracts held</span>
            <strong>100</strong>
          </div>
          <div>
            <span>Reference quote</span>
            <strong>$0.68</strong>
          </div>
          <div>
            <span>Reference value</span>
            <strong>$68.00</strong>
          </div>
        </div>
        <div className={styles.sizeRow}>
          <span>How much would you exit?</span>
          <div role="group" aria-label="Example exit size">
            {scenarios.map((scenario) => (
              <button
                key={scenario.size}
                type="button"
                aria-pressed={selected.size === scenario.size}
                onClick={() => setSelected(scenario)}
              >
                {scenario.size}%
              </button>
            ))}
          </div>
        </div>
        <div className={styles.estimate} aria-live="polite" aria-atomic="true">
          <span>
            Estimated proceeds{" "}
            <span className={styles.beforeFees}>before fees</span>
          </span>
          <strong>${selected.proceeds}</strong>
          <p>
            {selected.size} contracts · ${selected.price} average bid price
          </p>
        </div>
        <div className={styles.depth}>
          <div className={styles.depthHeading}>
            <span>Available bid depth</span>
            <span>Contracts →</span>
          </div>
          <svg
            viewBox="0 0 420 112"
            role="img"
            aria-label={`Illustrative bid prices decrease as exit size grows. Selected exit size: ${selected.size} contracts.`}
          >
            <path
              d="M0 20H420M0 60H420M0 100H420"
              stroke="#E3E7DF"
              strokeDasharray="3 5"
            />
            <path d="M0 25H105V42H210V59H315V88H420V112H0Z" fill="#E6EED7" />
            <clipPath id="selected-example-depth">
              <rect width={selected.size * 4.2} height="112" />
            </clipPath>
            <path
              d="M0 25H105V42H210V59H315V88H420V112H0Z"
              fill="#D8F36A"
              clipPath="url(#selected-example-depth)"
            />
            <path
              d="M0 25H105V42H210V59H315V88H420"
              fill="none"
              stroke="#657A3B"
              strokeWidth="2.5"
            />
            <path
              d={`M${selected.size * 4.2 - 1} 6V112`}
              stroke="#344825"
              strokeDasharray="4 4"
            />
          </svg>
          <div className={styles.depthAxis}>
            <span>0</span>
            <span>25</span>
            <span>50</span>
            <span>75</span>
            <span>100</span>
          </div>
        </div>
        <div className={styles.previewNote}>
          <span aria-hidden="true">↳</span>
          <p>
            A displayed value and an exit estimate can differ. Your size
            matters.
          </p>
        </div>
      </div>
      <div className={styles.previewFooter}>
        Example bids only. Actual estimates depend on current depth and fees.
      </div>
    </div>
  );
}
