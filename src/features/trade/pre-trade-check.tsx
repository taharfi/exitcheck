import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { decimal, money } from "@/lib/amounts";
import type { MarketItem } from "./types";
import type { TradeDecision } from "./decision";
import styles from "./terminal.module.css";

const units = z.string().regex(/^\d{1,40}$/);
const exitPreviewSchema = z.object({
  marketId: z.string(),
  side: z.enum(["YES", "NO"]),
  notice: z.string(),
  estimate: z.object({
    requested: units,
    fillable: units,
    gross: units,
    insufficient: z.boolean(),
    capturedAt: z.number().int(),
  }),
});
type ExitPreview = z.infer<typeof exitPreviewSchema>;

export function PreTradeCheck({
  market,
  side,
  quote,
  decision,
  now,
}: {
  market: MarketItem;
  side: "YES" | "NO";
  quote: { shares: string; cost: string; payout: string; fee?: string } | null;
  decision: TradeDecision | null;
  now: number;
}) {
  const [preview, setPreview] = useState<ExitPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const fresh =
    preview !== null &&
    preview.marketId === market.id &&
    preview.side === side &&
    preview.estimate.requested === quote?.shares &&
    preview.estimate.capturedAt <= now + 1000 &&
    now - preview.estimate.capturedAt <= 20000;
  const quoteFresh =
    market.tradable &&
    Date.parse(market.tradingClosesAt ?? market.resolutionDate) > now &&
    market.capturedAt <= now + 1000 &&
    now - market.capturedAt <= 60000;

  async function checkExit() {
    if (!quote || busy || !quoteFresh) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const response = await fetch("/api/trade/depth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketId: market.id,
          side,
          quantity: quote.shares,
        }),
        signal: request.signal,
      });
      const value: unknown = await response.json();
      if (!response.ok) {
        const failure = z
          .object({ error: z.object({ message: z.string() }) })
          .safeParse(value);
        throw Error(
          failure.success
            ? failure.data.error.message
            : "Exit depth unavailable. Try again.",
        );
      }
      const result = exitPreviewSchema.parse(value);
      if (
        result.marketId !== market.id ||
        result.side !== side ||
        result.estimate.requested !== quote.shares
      )
        throw Error("Exit preview does not match this order. Refresh it.");
      if (!request.signal.aborted) setPreview(result);
    } catch (e) {
      if (!request.signal.aborted)
        setError(e instanceof Error ? e.message : "Exit depth unavailable.");
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }

  return (
    <section className={styles.tradeCheck} aria-labelledby="trade-check-title">
      <div className={styles.sectionHeading}>
        <h3 id="trade-check-title">Check this trade</h3>
        <span className={styles.live}>PAPER REVIEW</span>
      </div>
      <p className={styles.notice}>
        Review {side} before approving your practice order.
      </p>
      <dl className={styles.checkStats}>
        <div>
          <dt>Maximum paper loss</dt>
          <dd>{quote ? money(quote.cost) : "Enter a valid order"}</dd>
        </div>
        <div>
          <dt>Payout if correct</dt>
          <dd>{quote ? money(quote.payout) : "Unknown"}</dd>
        </div>
        <div>
          <dt>Trading fees</dt>
          <dd>
            {quote?.fee && quote.fee !== "0"
              ? `${money(quote.fee)} paper assumption`
              : "Unknown · excluded"}
          </dd>
        </div>
        <div>
          <dt>Current exit estimate</dt>
          <dd>
            {fresh && preview
              ? `${money(preview.estimate.gross)} gross`
              : "Unknown"}
          </dd>
        </div>
      </dl>
      <p className={styles.notice}>
        Maximum loss is the simulated spend including any chosen paper fee
        assumption; actual fees are unknown. Payout is the total returned if
        this outcome wins, not profit.
      </p>
      <p className={styles.notice}>
        {market.eventKey
          ? "Shared-event cap: $300 across recognized outcomes of this event, plus $200 per market. This is explicit event grouping, not estimated correlation."
          : "No shared-event identity is available. Related exposure across other markets cannot be verified."}
      </p>
      <div className={styles.checkDecision}>
        <strong>
          {!quoteFresh
            ? "Refresh the market"
            : (decision?.title ?? "Wait for evidence")}
        </strong>
        <p>
          {!quoteFresh
            ? "The market quote is stale or unavailable. Refresh before reviewing an order."
            : (decision?.reason ??
              "Research has not established an evidence-backed reason to favour either side. You can still practice manually.")}
        </p>
      </div>
      <button
        type="button"
        className={styles.checkExit}
        disabled={!quote || !quoteFresh || busy}
        onClick={() => void checkExit()}
      >
        {busy ? "Checking live bids…" : "Check current exit liquidity"}
      </button>
      <p className={styles.notice} role="status">
        {error ||
          (fresh && preview
            ? `${decimal(preview.estimate.fillable)} of ${decimal(preview.estimate.requested)} shares covered by current bids. ${preview.estimate.insufficient ? "Insufficient depth for a full exit. " : ""}Fees unknown. This snapshot does not guarantee a fill or future exit.`
            : preview
              ? "Exit snapshot expired. Check again for current depth."
              : "Exit capacity has not been checked for this quantity. Market volume does not establish an available exit.")}
      </p>
      <details className={styles.checkRules}>
        <summary>Resolution rules and source</summary>
        <p>
          Reported source: {market.oracleSource || "Unknown"}. Confirm the rules
          on the original market before funding a trade.
        </p>
        <p>{market.rules || "Rules are unavailable in this feed."}</p>
        <a href={market.url} target="_blank" rel="noopener noreferrer">
          Open original market ↗
        </a>
      </details>
    </section>
  );
}
