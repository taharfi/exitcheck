import { z } from "zod";
import type { MarketItem } from "@/features/trade/types";
export const planSchema = z
  .object({
    budget: z.number().min(30).max(10000).multipleOf(0.01),
    days: z.number().int().min(1).max(30),
  })
  .strict();
export type Plan = z.infer<typeof planSchema>;
export type Position = {
  marketId: string;
  question: string;
  shares: number;
  entry: number;
  mark: number;
  stale: boolean;
};
export type Strategy = {
  name: string;
  cash: number;
  positions: Position[];
  peak: number;
  drawdown: number;
  decisions: string[];
};
export type Experiment = {
  id: string;
  version: 1;
  plan: Plan;
  startedAt: number;
  endsAt: number;
  updatedAt: number;
  paused: boolean;
  complete: boolean;
  strategies: Strategy[];
};
export function parseRequest(text: string): Plan {
  if (/\b(live|real|execute|leverage|short|buy|sell)\b/i.test(text))
    throw new Error("Only paper budget experiments are supported.");
  const strategyCount = text.match(/(\d+)\s*strateg(?:y|ies)/i)?.[1];
  if (strategyCount && Number(strategyCount) !== 3)
    throw new Error("Exactly three strategy templates are supported.");
  const budget =
    text.match(/(?:\$|budget\s*(?:of\s*)?)(\d+(?:\.\d{1,2})?)/i)?.[1] ??
    text.match(/\b(\d+(?:\.\d{1,2})?)\s*(?:usd|usdc|budget)/i)?.[1];
  if (!budget)
    throw new Error(
      "Include a budget, for example: Test $300 across 3 strategies for 7 days.",
    );
  const days = text.match(/(\d+)\s*days?/i)?.[1];
  return planSchema.parse({
    budget: Number(budget),
    days: days ? Number(days) : 7,
  });
}
export function createExperiment(
  id: string,
  plan: Plan,
  now: number,
): Experiment {
  const cents = Math.round(plan.budget * 100),
    allocation = Math.floor(cents / 3);
  return {
    id,
    version: 1,
    plan,
    startedAt: now,
    endsAt: now + plan.days * 86400000,
    updatedAt: 0,
    paused: false,
    complete: false,
    strategies: [
      "Market baseline",
      "Evidence threshold",
      "Liquidity filter",
    ].map((name, i) => {
      const cash = (allocation + (i === 2 ? cents - allocation * 3 : 0)) / 100;
      return {
        name,
        cash,
        positions: [],
        peak: cash,
        drawdown: 0,
        decisions: [],
      };
    }),
  };
}
export function advanceExperiment(
  exp: Experiment,
  markets: MarketItem[],
  now: number,
): Experiment {
  if (exp.paused || exp.complete || now - exp.updatedAt < 60000) return exp;
  const next: Experiment = structuredClone(exp);
  for (const strategy of next.strategies) {
    strategy.decisions = [];
    for (const position of strategy.positions) {
      const m = markets.find((x) => x.id === position.marketId);
      position.stale = !m || m.yesPrice === null || now - m.capturedAt > 60000;
      if (!position.stale && m?.yesPrice !== null && m?.yesPrice !== undefined)
        position.mark = m.yesPrice;
    }
    if (now >= exp.endsAt) {
      strategy.decisions.push(
        "Experiment ended. Positions remain marked; no settlement or sale is assumed.",
      );
    } else if (strategy.name === "Evidence threshold")
      strategy.decisions.push(
        "Wait: independently verified probability evidence is not connected.",
      );
    else {
      const candidates = markets
        .filter(
          (m) =>
            m.tradable &&
            m.yesPrice !== null &&
            m.yesPrice >= 0.1 &&
            m.yesPrice <= 0.9 &&
            now - m.capturedAt <= 60000 &&
            Date.parse(m.resolutionDate) > exp.endsAt &&
            !strategy.positions.some((p) => p.marketId === m.id),
        )
        .sort(
          (a, b) =>
            (b.volume24h ?? 0) - (a.volume24h ?? 0) || a.id.localeCompare(b.id),
        );
      const m = candidates.find(
        (m) =>
          strategy.name !== "Liquidity filter" || (m.liquidity ?? 0) >= 10000,
      );
      if (strategy.positions.length >= 3)
        strategy.decisions.push("Wait: three-position limit reached.");
      else if (m && m.yesPrice !== null) {
        const cost = Math.min(strategy.cash, (exp.plan.budget / 3) * 0.2);
        if (cost >= 1) {
          strategy.cash -= cost;
          strategy.positions.push({
            marketId: m.id,
            question: m.question,
            shares: cost / (m.yesPrice * 1.0005),
            entry: m.yesPrice,
            mark: m.yesPrice,
            stale: false,
          });
          strategy.decisions.push(
            `Paper YES: ${m.question}. Benchmark entry, not a probability forecast.`,
          );
        }
      } else strategy.decisions.push("Wait: no eligible fresh market quote.");
    }
    const equity =
      strategy.cash +
      strategy.positions.reduce((n, p) => n + p.shares * p.mark, 0);
    strategy.peak = Math.max(strategy.peak, equity);
    strategy.drawdown = Math.max(strategy.drawdown, strategy.peak - equity);
  }
  next.updatedAt = now;
  next.complete = now >= exp.endsAt;
  return next;
}
