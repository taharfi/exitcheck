import type { HistorySample } from "./history-loader";
export function copyability(sample: HistorySample, budget: string) {
  const buys = sample.history.filter(
    (h) =>
      h.eventType === "order_filled" &&
      h.isBuy &&
      BigInt(h.filledContractsMicro) > 0n,
  );
  const costs = buys
    .map(
      (h) =>
        (BigInt(h.filledContractsMicro) * BigInt(h.avgFillPriceUsd)) / 1000000n,
    )
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const median = costs.length
    ? costs.length % 2
      ? costs[Math.floor(costs.length / 2)]
      : (costs[costs.length / 2 - 1] + costs[costs.length / 2]) / 2n
    : null;
  return {
    observedBuys: buys.length,
    observedSells: sample.history.filter(
      (h) => h.eventType === "order_filled" && !h.isBuy,
    ).length,
    uniqueBuyEvents: new Set(buys.map((h) => h.eventId).filter(Boolean)).size,
    medianLeaderBuy: median === null ? null : String(median),
    proposedEntry: String(BigInt(budget) / 20n),
    budget,
    holdingDuration: null,
    followerDepth: "Unverified",
    assessment: sample.complete
      ? "Returned history pages fetched; follower execution remains unverified."
      : "Incomplete history: this describes retrieved trades, not lifetime behavior.",
  };
}
