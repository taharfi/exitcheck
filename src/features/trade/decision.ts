import type { MarketItem, ResearchResult } from "./types";
export type TradeDecision = {
  action: "WAIT" | "YES" | "NO";
  title: string;
  reason: string;
};
export function tradeDecision(
  report: ResearchResult,
  market: MarketItem,
  now: number,
): TradeDecision {
  const wait = (reason: string): TradeDecision => ({
    action: "WAIT",
    title: "Wait",
    reason,
  });
  if (
    report.marketId !== market.id ||
    !market.tradable ||
    Date.parse(market.tradingClosesAt ?? market.resolutionDate) <= now ||
    now - market.capturedAt > 60000
  )
    return wait("The market or quote is unavailable. Refresh before deciding.");
  if (
    now - report.capturedAt > 120000 ||
    report.marketProbability !== market.yesPrice
  )
    return wait(
      "The report no longer matches the live quote. Refresh research.",
    );
  if (report.mode !== "gemini" || report.citations.length < 2)
    return wait(
      "There is not enough independent evidence to favour either side.",
    );
  if (report.confidence < 0.6 || report.proposedTrade.action === "PASS")
    return wait("The evidence does not justify an entry at this price.");
  const side = report.proposedTrade.action === "BUY_YES" ? "YES" : "NO";
  const price = side === "YES" ? market.yesPrice : market.noPrice;
  if (price === null || price <= 0 || price >= 1)
    return wait("This side has no usable live quote.");
  const probability =
    side === "YES" ? report.fairProbability : 1 - report.fairProbability;
  if (probability - price * 1.0005 < 0.03)
    return wait("The estimated edge is too small after simulated slippage.");
  return {
    action: side,
    title: `Consider paper ${side}`,
    reason: `The model estimates an edge for ${side} at the current quote. Review the sources and unknown fees before approving a paper order.`,
  };
}
