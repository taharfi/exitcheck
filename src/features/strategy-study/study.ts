import type { MarketPoint } from "@/features/prediction-bot/market-recorder";
export const RULES = {
  version: 1,
  trigger: 0.03,
  maxGapMs: 90000,
  maxSpread: 0.05,
  allocation: 0.2,
  feeRate: 0.01,
  slippage: 0.0005,
  holdMs: 3600000,
  stop: 0.05,
} as const;
export type StudyResult = {
  name: string;
  cash: number;
  equity: number;
  realized: number;
  drawdown: number;
  signals: number;
  blocked: number;
  closed: number;
  open: number;
  log: { at: number; market: string; decision: string }[];
};
type Held = {
  quantity: number;
  cost: number;
  at: number;
  entry: number;
  mark: number;
};
export function replay(points: MarketPoint[], budget: number) {
  const ordered = [...points].sort((a, b) => a.at - b.at);
  const split = ordered.length
    ? (ordered[Math.floor(ordered.length * 0.7)]?.at ?? ordered.at(-1)!.at)
    : 0;
  const evaluate = (name: string, start: number, end: number): StudyResult => {
    const result: StudyResult = {
      name,
      cash: budget,
      equity: budget,
      realized: 0,
      drawdown: 0,
      signals: 0,
      blocked: 0,
      closed: 0,
      open: 0,
      log: [],
    };
    const previous = new Map<string, MarketPoint>(),
      held = new Map<string, Held>();
    let peak = budget;
    for (const p of ordered) {
      if (p.at < start || p.at >= end) continue;
      const old = previous.get(p.route.id);
      previous.set(p.route.id, p);
      const bid = p.route.bid === null ? null : Number(p.route.bid) / 1e6,
        ask = p.route.ask === null ? null : Number(p.route.ask) / 1e6;
      const valid =
        p.verified &&
        p.route.status === "open" &&
        p.route.closesAt !== null &&
        p.route.closesAt > p.at &&
        p.routeAt !== undefined &&
        p.routeAt <= p.at &&
        p.at - p.routeAt <= 20000 &&
        bid !== null &&
        ask !== null &&
        bid > 0 &&
        ask < 1 &&
        ask >= bid;
      const note = (decision: string) => {
        result.log.push({ at: p.at, market: p.route.id, decision });
      };
      if (!valid || bid === null || ask === null) {
        result.blocked++;
        note("Skip: missing, stale, closed or unverified quote.");
        continue;
      }
      const position = held.get(p.route.id);
      if (position) {
        position.mark = bid;
        const exit =
          p.at - position.at >= RULES.holdMs ||
          Math.abs(Math.round((bid - position.entry) * 1e6)) >=
            Math.round(RULES.stop * 1e6);
        if (exit) {
          const depth = p.exitDepth;
          let remaining = position.quantity,
            gross = 0;
          if (
            depth &&
            depth.capturedAt <= p.at &&
            p.at - depth.capturedAt <= 20000
          ) {
            for (const level of [...depth.yes].sort(
              (a, b) => Number(b.price) - Number(a.price),
            )) {
              const qty = Math.min(remaining, Number(level.quantity) / 1e6);
              gross += (qty * Number(level.price)) / 1e6;
              remaining -= qty;
              if (remaining < 1e-8) break;
            }
          }
          if (remaining > 1e-8) {
            result.blocked++;
            note("Hold: sufficient fresh exit depth unavailable.");
          } else {
            const proceeds = gross * (1 - RULES.feeRate - RULES.slippage);
            result.cash += proceeds;
            result.realized += proceeds - position.cost;
            held.delete(p.route.id);
            result.closed++;
            note("Modeled paper exit at recorded bids; fee/slippage assumed.");
          }
        }
      } else if (
        name !== "Cash benchmark" &&
        old &&
        p.at > old.at &&
        p.at - old.at <= RULES.maxGapMs &&
        old.route.bid !== null &&
        old.route.rules === p.route.rules &&
        old.route.outcome === p.route.outcome &&
        JSON.stringify(old.route.tokenIds) ===
          JSON.stringify(p.route.tokenIds) &&
        old.verified &&
        old.routeAt !== undefined &&
        old.routeAt <= old.at &&
        old.at - old.routeAt <= 20000
      ) {
        const delta = (Number(p.route.bid) - Number(old.route.bid)) / 1e6;
        const signal =
          name === "Mean reversion"
            ? delta <= -RULES.trigger
            : delta >= RULES.trigger;
        if (signal) {
          result.signals++;
          const cost = Math.min(result.cash, budget * RULES.allocation);
          const quantity = cost / (ask * (1 + RULES.feeRate + RULES.slippage));
          const capacity =
            p.exitDepth?.yes.reduce(
              (n, l) => n + Number(l.quantity) / 1e6,
              0,
            ) ?? 0;
          const liquid =
            name !== "Liquidity-aware momentum" ||
            (p.exitDepth !== undefined &&
              p.exitDepth.capturedAt <= p.at &&
              p.at - p.exitDepth.capturedAt <= 20000 &&
              capacity >= quantity &&
              ask - bid <= RULES.maxSpread);
          if (!liquid || cost < 1 || held.size >= 3) {
            result.blocked++;
            note("Skip: liquidity, cash or position limit.");
          } else {
            result.cash -= cost;
            held.set(p.route.id, {
              quantity,
              cost,
              at: p.at,
              entry: ask,
              mark: bid,
            });
            note(
              "Modeled paper YES entry at ask; entry size is NOT verified executable.",
            );
          }
        }
      }
      result.equity =
        result.cash +
        [...held.values()].reduce((n, h) => n + h.quantity * h.mark, 0);
      peak = Math.max(peak, result.equity);
      result.drawdown = Math.max(result.drawdown, peak - result.equity);
    }
    result.open = held.size;
    result.log = result.log.slice(-100);
    return result;
  };
  const names = [
    "Cash benchmark",
    "Momentum",
    "Mean reversion",
    "Liquidity-aware momentum",
  ];
  return {
    rules: RULES,
    observations: ordered.length,
    verifiedObservations: ordered.filter((p) => p.verified).length,
    depthObservations: ordered.filter((p) => p.exitDepth !== undefined).length,
    latestCohort: [
      ...new Map(ordered.map((p) => [p.route.id, p])).values(),
    ].map((p) => ({
      id: p.route.id,
      status: p.route.status,
      verified: p.verified,
      reason: p.reason,
      depth: !!p.exitDepth,
      depthError: p.depthError ?? null,
      resolvedResult: p.route.resolvedResult ?? null,
      at: p.at,
    })),
    firstAt: ordered[0]?.at ?? null,
    lastAt: ordered.at(-1)?.at ?? null,
    splitAt: split,
    development: names.map((n) => evaluate(n, -Infinity, split)),
    evaluation: names.map((n) => evaluate(n, split, Infinity)),
    qualified: false,
    notice:
      "Quote-only paper study, not executable fills. Fixed 1% fee and 0.05% slippage assumptions per entry/exit; entry capacity unverified. Fresh recorded bid depth required for full exits. Open positions are marked, not settled. Chronological 70/30 split resets cash and lookback for evaluation; no parameter fitting. No strategy is qualified.",
  };
}
export function mockExecutionCase() {
  const seen = new Set<string>();
  let fills = 0;
  const execute = (
    id: string,
    approved: boolean,
    fresh: boolean,
    liquid: boolean,
  ) => {
    if (!approved || !fresh || !liquid) return "blocked";
    if (seen.has(id)) return "duplicate ignored";
    seen.add(id);
    fills++;
    return "mock filled";
  };
  return {
    mode: "mock" as const,
    steps: [
      execute("a", false, true, true),
      execute("a", true, false, true),
      execute("a", true, true, false),
      execute("a", true, true, true),
      execute("a", true, true, true),
    ],
    fills,
    notice:
      "In-memory mock execution only. No wallet, RPC, transaction or actual devnet prediction fill.",
  };
}
