import { z } from "zod";
import { AppError } from "@/lib/errors";
import { SCALE } from "@/lib/amounts";
import { marketSchema, integer, parseDepth } from "@/lib/provider/schemas";
import { calculateExit } from "@/features/exits/calculations";
import type { Depth, Estimate } from "@/features/exits/types";
import type { AgentDecision } from "./agent-model";
import type { AgentRequest } from "./agent-source";
import type { WalletReview } from "./agent-wallet";

const reviewMarket = marketSchema.extend({
  eventId: z.string().min(1),
  tradable: z.boolean().optional(),
  pricing: z
    .object({
      buyYesPriceUsd: integer.nullable(),
      buyNoPriceUsd: integer.nullable(),
    })
    .nullable(),
});
type MarketReading = z.infer<typeof reviewMarket> & { at: number };
export type AgentEntryReview = {
  decisionId: string;
  checkedAt: number;
  expiresAt: number;
  sourceDelayMs: number;
  market: { title: string; provider: string; closesAt: number } | null;
  entry: {
    status: "within_limit" | "blocked" | "unknown";
    reason: string;
    quotePrice: string | null;
    differenceBps: string | null;
    hypotheticalContracts: string | null;
  };
  exit: {
    status: "covered" | "limited" | "unknown";
    reason: string;
    estimate: Estimate | null;
    coverageBps: string | null;
  };
  execution: "disabled";
  wallet?: WalletReview;
};

export function evaluateAgentEntry(
  decision: AgentDecision,
  market: MarketReading | null,
  depth: Depth | null,
  exchange: { active: boolean; at: number } | null,
  now: number,
): AgentEntryReview {
  const report: AgentEntryReview = {
    decisionId: decision.id,
    checkedAt: now,
    expiresAt: Math.min(now + 20000, decision.expiresAt),
    sourceDelayMs: Math.max(0, decision.observedAt - decision.sourceAt),
    market: market
      ? {
          title: market.title,
          provider: market.provider,
          closesAt: market.closeTime * 1000,
        }
      : null,
    entry: {
      status: "unknown",
      reason: "A fresh indicative entry quote is unavailable.",
      quotePrice: null,
      differenceBps: null,
      hypotheticalContracts: null,
    },
    exit: {
      status: "unknown",
      reason:
        "Fresh exit depth is unavailable. Missing data does not mean zero liquidity.",
      estimate: null,
      coverageBps: null,
    },
    execution: "disabled",
  };
  if (
    decision.status !== "review" ||
    decision.action !== "buy" ||
    decision.expiresAt <= now ||
    decision.sourceAt > now + 5000 ||
    now - decision.sourceAt > 120000
  ) {
    report.entry = {
      ...report.entry,
      status: "blocked",
      reason: "This preliminary proposal is no longer active.",
    };
    return report;
  }
  if (!market) return report;
  if (
    market.marketId !== decision.marketId ||
    market.eventId !== decision.eventId
  )
    throw new AppError(
      "MARKET_MISMATCH",
      "The returned market does not match this proposal. No trade was authorized.",
      502,
    );
  if (!Number.isSafeInteger(market.closeTime * 1000))
    throw new AppError(
      "INVALID_MARKET_TIME",
      "The market deadline could not be verified.",
      502,
    );
  const fresh = (at: number) =>
    Number.isFinite(at) && at <= now && now - at <= 20000;
  if (!fresh(market.at)) return report;
  report.expiresAt = Math.min(report.expiresAt, market.at + 20000);
  if (
    !["polymarket", "gx"].includes(market.provider) ||
    market.status !== "open" ||
    market.result !== null ||
    market.closeTime * 1000 <= now ||
    market.tradable === false
  ) {
    report.entry = {
      ...report.entry,
      status: "blocked",
      reason:
        "This market is closed, resolved, unsupported or unavailable for trading.",
    };
    return report;
  }
  const rawPrice =
    decision.side === "yes"
      ? market.pricing?.buyYesPriceUsd
      : market.pricing?.buyNoPriceUsd;
  if (
    !rawPrice ||
    BigInt(rawPrice) <= 0n ||
    BigInt(rawPrice) >= SCALE ||
    BigInt(decision.allocation) <= 0n ||
    BigInt(decision.leaderPrice) <= 0n ||
    BigInt(decision.leaderPrice) >= SCALE
  )
    return report;
  const price = BigInt(rawPrice),
    leader = BigInt(decision.leaderPrice);
  const quantity = (BigInt(decision.allocation) * SCALE) / price;
  report.entry.quotePrice = rawPrice;
  report.entry.differenceBps = (
    ((price - leader) * 10000n) /
    leader
  ).toString();
  report.entry.hypotheticalContracts = quantity.toString();
  if (!exchange || !fresh(exchange.at)) {
    report.entry.reason =
      "The current quote is available, but exchange availability could not be verified.";
  } else {
    report.expiresAt = Math.min(report.expiresAt, exchange.at + 20000);
    const allowed =
      exchange.active && quantity > 0n && price * 10000n <= leader * 10300n;
    report.entry.status = allowed ? "within_limit" : "blocked";
    report.entry.reason = !exchange.active
      ? "The exchange is not open for trading."
      : quantity === 0n
        ? "This allocation cannot purchase a measurable quantity at this quote."
        : !allowed
          ? "The current indicative quote is more than 3% above the trader's fill."
          : "Indicative price is within the 3% planning limit. Buy depth and fees remain unverified; wallet funds and positions are checked separately.";
  }
  if (!depth || !fresh(depth.capturedAt) || quantity <= 0n) return report;
  report.expiresAt = Math.min(report.expiresAt, depth.capturedAt + 20000);
  // Positive same-side bids estimate an exit only. They do not prove buy execution.
  const positive = {
    ...depth,
    yes: depth.yes.filter((x) => BigInt(x.price) > 0n),
    no: depth.no.filter((x) => BigInt(x.price) > 0n),
  };
  const estimate = calculateExit({
    quantity: quantity.toString(),
    held: quantity.toString(),
    isYes: decision.side === "yes",
    depth: positive,
    referencePrice: null,
    now,
  });
  report.exit = {
    status: estimate.insufficient ? "limited" : "covered",
    estimate,
    coverageBps: ((BigInt(estimate.fillable) * 10000n) / quantity).toString(),
    reason: estimate.insufficient
      ? "Current positive bids cover only part of this hypothetical size. The uncovered amount has no estimated proceeds."
      : "Current positive bids cover this hypothetical size in the retrieved snapshot. This does not guarantee a future exit.",
  };
  return report;
}

export async function inspectAgentEntry(
  decision: AgentDecision,
  request: AgentRequest,
  clock = Date.now,
) {
  const read = async (path: string) => ({
    data: await request(path),
    at: clock(),
  });
  const [marketResult, bookResult, exchangeResult] = await Promise.allSettled([
    read("/markets/" + encodeURIComponent(decision.marketId)),
    read("/orderbook/" + encodeURIComponent(decision.marketId)),
    read("/trading-status"),
  ]);
  let market: MarketReading | null = null,
    depth: Depth | null = null,
    exchange: { active: boolean; at: number } | null = null;
  if (marketResult.status === "fulfilled") {
    const parsed = reviewMarket.safeParse(marketResult.value.data);
    if (parsed.success) market = { ...parsed.data, at: marketResult.value.at };
  }
  if (bookResult.status === "fulfilled") {
    try {
      depth = parseDepth(bookResult.value.data, bookResult.value.at);
    } catch {
      /* Invalid depth stays unknown. */
    }
  }
  if (exchangeResult.status === "fulfilled") {
    const parsed = z
      .object({ trading_active: z.boolean() })
      .safeParse(exchangeResult.value.data);
    if (parsed.success)
      exchange = {
        active: parsed.data.trading_active,
        at: exchangeResult.value.at,
      };
  }
  return evaluateAgentEntry(decision, market, depth, exchange, clock());
}
