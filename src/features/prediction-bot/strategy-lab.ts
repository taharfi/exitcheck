import type { MarketPoint } from "./market-recorder";
export type StrategyResult = {
  strategy: string;
  observations: number;
  signals: number;
  blocked: number;
  reason: string;
  qualified: false;
};
export function compareStrategies(points: MarketPoint[]): StrategyResult[] {
  const ordered = [...points].sort((a, b) => a.at - b.at),
    previous = new Map<string, MarketPoint>();
  let momentum = 0,
    divergence = 0,
    verified = 0;
  const eligible = (p: MarketPoint) =>
    p.verified &&
    p.routeAt !== undefined &&
    p.externalAt !== undefined &&
    p.externalAt !== null &&
    p.routeAt <= p.at &&
    p.externalAt <= p.at &&
    p.at - p.routeAt <= 20000 &&
    p.at - p.externalAt <= 20000 &&
    p.external?.status === "open" &&
    p.route.status === "open" &&
    p.route.closesAt !== null &&
    p.route.closesAt > p.at &&
    p.route.bid !== null &&
    p.route.ask !== null &&
    BigInt(p.route.ask) >= BigInt(p.route.bid);
  for (const p of ordered) {
    const old = previous.get(p.route.id);
    if (eligible(p) && p.route.bid !== null && p.route.ask !== null) {
      verified++;
      // Frozen 3 percentage-point trigger; use only the preceding observation, never future values.
      if (
        old &&
        eligible(old) &&
        old.route.rules === p.route.rules &&
        JSON.stringify(old.route.tokenIds) ===
          JSON.stringify(p.route.tokenIds) &&
        JSON.stringify(old.route.outcomes) ===
          JSON.stringify(p.route.outcomes) &&
        old.route.outcome === p.route.outcome &&
        old.route.bid !== null &&
        p.at > old.at &&
        p.at - old.at <= 90000 &&
        BigInt(p.route.bid) - BigInt(old.route.bid) >= 30000n
      )
        momentum++;
      if (
        p.independent &&
        p.external?.bid !== null &&
        p.external?.bid !== undefined &&
        BigInt(p.external.bid) - BigInt(p.route.ask) >= 50000n
      )
        divergence++;
    }
    previous.set(p.route.id, p);
  }
  return [
    {
      strategy: "No trade",
      observations: ordered.length,
      signals: 0,
      blocked: 0,
      reason: "Baseline: keep 100% of the virtual budget in cash.",
      qualified: false,
    },
    {
      strategy: "Momentum",
      observations: verified,
      signals: momentum,
      blocked: momentum,
      reason:
        "Watch a 3-point rise between fresh observations. Entries blocked until Solana buy depth, fees and fills are verified.",
      qualified: false,
    },
    {
      strategy: "Price divergence",
      observations: verified,
      signals: divergence,
      blocked: divergence,
      reason:
        "Requires a verified independent reference at least 5 points above the Solana ask. Same underlying Polymarket feed is not independent.",
      qualified: false,
    },
  ];
}
