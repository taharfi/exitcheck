import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { JupiterProvider } from "@/lib/provider/jupiter";
import { marketSchema, integer } from "@/lib/provider/schemas";
import {
  readAgentHistory,
  type AgentFill,
  type AgentRequest,
} from "./agent-source";
import { agentStore, type AgentStore } from "./agent-store";
import type { AgentPlan, AgentDecision } from "./agent-model";

const quoteSchema = marketSchema.extend({
  eventId: z.string().min(1),
  tradable: z.boolean().optional(),
  pricing: z
    .object({
      buyYesPriceUsd: integer.nullable(),
      buyNoPriceUsd: integer.nullable(),
    })
    .nullable(),
});
export type AgentQuote = z.infer<typeof quoteSchema> & { at: number };
export function proposeAgentFill(
  plan: AgentPlan,
  fill: AgentFill,
  quote: AgentQuote | null,
  active: boolean,
  reservations: Awaited<ReturnType<AgentStore["reservations"]>>,
  now: number,
): AgentDecision {
  const d: AgentDecision = {
    id: randomUUID(),
    planId: plan.id,
    sourceId: fill.id,
    sourceSignature: fill.signature ?? null,
    sourceAt: fill.timestamp * 1000,
    observedAt: now,
    expiresAt: Math.min(now + 120000, fill.timestamp * 1000 + 120000),
    marketId: fill.marketId,
    eventId: fill.eventId,
    title:
      fill.eventMetadata?.title ?? fill.marketMetadata?.title ?? fill.marketId,
    side: fill.isYes ? "yes" : "no",
    action: fill.isBuy ? "buy" : "sell",
    leaderPrice: fill.avgFillPriceUsd,
    leaderContracts: fill.filledContractsMicro,
    quotePrice: null,
    quoteAt: null,
    allocation: "0",
    status: "skipped",
    reason: "",
  };
  const skip = (reason: string) => ({ ...d, reason });
  if (d.sourceAt <= plan.acceptAfter)
    return skip(
      "The fill predates activation or the current observation baseline.",
    );
  if (d.sourceAt > now + 5000 || now - d.sourceAt > 120000)
    return skip(
      "The fill is older than two minutes or has a future timestamp.",
    );
  if (
    BigInt(fill.filledContractsMicro) === 0n ||
    BigInt(fill.avgFillPriceUsd) <= 0n ||
    BigInt(fill.avgFillPriceUsd) >= 1000000n
  )
    return skip("The source fill has no usable quantity or price.");
  if (!fill.isBuy)
    return {
      ...d,
      status: "exit_signal",
      reason:
        "A trader sell was detected. This stage has no executed copy positions to sell; review it in your positions workspace.",
    };
  if (!active)
    return skip("The exchange is unavailable or not open for trading.");
  if (!quote)
    return skip(
      "A current market quote could not be verified within this poll's ten-market limit.",
    );
  if (quote.marketId !== fill.marketId || quote.eventId !== fill.eventId)
    return skip("The market or event identity does not match the source fill.");
  if (!["polymarket", "gx"].includes(quote.provider))
    return skip(
      "This market provider has not been reviewed for this copy workflow.",
    );
  if (
    quote.status !== "open" ||
    quote.result !== null ||
    quote.closeTime * 1000 <= now ||
    quote.tradable === false
  )
    return skip("The market is closed, resolved or not tradeable.");
  if (quote.at > now || now - quote.at > 20000)
    return skip("The market quote is stale or has an invalid timestamp.");
  const price = fill.isYes
    ? quote.pricing?.buyYesPriceUsd
    : quote.pricing?.buyNoPriceUsd;
  if (!price || BigInt(price) <= 0n || BigInt(price) >= 1000000n)
    return skip("The selected outcome has no usable buy quote.");
  d.quotePrice = price;
  d.quoteAt = quote.at;
  if (BigInt(price) * 10000n > BigInt(fill.avgFillPriceUsd) * 10300n)
    return skip(
      "The indicative buy price is more than 3% above the trader's fill price.",
    );
  const amount = BigInt(plan.entry),
    budget = BigInt(plan.budget);
  if (reservations.total + amount > (budget * 80n) / 100n)
    return skip("Pending proposals reached the 80% planning allocation limit.");
  if ((reservations.events.get(fill.eventId) ?? 0n) + amount > budget / 5n)
    return skip(
      "Pending proposals for this event reached 20% of the planning budget.",
    );
  return {
    ...d,
    allocation: plan.entry,
    status: "review",
    reason:
      "Preliminary entry proposal. Follower fees, executable depth, transaction limits and signing still require verification. No order has been placed.",
  };
}

export async function collectAgentPlan(
  store: AgentStore,
  original: AgentPlan,
  request: AgentRequest,
  clock = Date.now,
) {
  const startedAt = clock();
  const token = await store.acquire(original, startedAt);
  if (!token) return false;
  try {
    const sample = await readAgentHistory(
      original.trader,
      original.cursor,
      request,
    );
    const quotes = new Map<string, AgentQuote>();
    const freshBuys = sample.fills.filter(
      (fill) =>
        fill.isBuy &&
        fill.timestamp * 1000 > original.acceptAfter &&
        clock() - fill.timestamp * 1000 <= 120000 &&
        fill.timestamp * 1000 <= clock() + 5000,
    );
    let active = false;
    if (freshBuys.length) {
      try {
        active = z
          .object({ trading_active: z.boolean() })
          .parse(await request("/trading-status")).trading_active;
      } catch {
        /* Missing trading status blocks entry proposals. */
      }
      if (active)
        for (const id of [
          ...new Set(freshBuys.map((fill) => fill.marketId)),
        ].slice(0, 10)) {
          try {
            const quote = quoteSchema.parse(
              await request("/markets/" + encodeURIComponent(id)),
            );
            quotes.set(id, { ...quote, at: clock() });
          } catch {
            /* A failed or unverified quote is recorded as a skip. */
          }
        }
    }
    const finished = clock(),
      reserved = await store.reservations(original.id, finished),
      decisions: AgentDecision[] = [];
    for (const fill of sample.fills) {
      const decision = proposeAgentFill(
        original,
        fill,
        quotes.get(fill.marketId) ?? null,
        active,
        reserved,
        finished,
      );
      decisions.push(decision);
      if (decision.status === "review") {
        reserved.total += BigInt(decision.allocation);
        reserved.events.set(
          fill.eventId,
          (reserved.events.get(fill.eventId) ?? 0n) +
            BigInt(decision.allocation),
        );
      }
    }
    return await store.commit(
      original,
      token,
      {
        ...original,
        cursor: sample.cursor,
        lastPoll: finished,
        lastSuccess: finished,
        polls: original.polls + 1,
        pages: sample.pages,
        error: null,
      },
      decisions,
      finished,
      {
        startedAt,
        at: finished,
        kind: sample.baseline ? "baseline" : "overlap",
        pages: sample.pages,
        errorCode: null,
      },
    );
  } catch (e) {
    const finished = clock();
    const error =
      e instanceof AppError
        ? e
        : new AppError(
            "INVALID_HISTORY",
            "Wallet history failed validation. Watching is paused.",
            502,
          );
    const fatal = [
      "HISTORY_OWNER",
      "HISTORY_CHANGED",
      "HISTORY_ORDER",
      "HISTORY_GAP",
      "HISTORY_PAGINATION",
      "INVALID_HISTORY",
    ].includes(error.code);
    return await store.commit(
      original,
      token,
      {
        ...original,
        status: fatal ? "paused" : original.status,
        lastPoll: finished,
        polls: original.polls + 1,
        gaps: original.gaps + (fatal ? 1 : 0),
        error: error.message,
      },
      [],
      finished,
      {
        startedAt,
        at: finished,
        kind: fatal ? "gap" : "failure",
        pages: null,
        errorCode: error.code,
      },
    );
  } finally {
    await store.release(original.id, token);
  }
}

const runtime = globalThis as typeof globalThis & {
  exitcheckAgentTimer?: ReturnType<typeof setInterval>;
  exitcheckAgentBusy?: boolean;
};
export function startAgentCollector() {
  if (runtime.exitcheckAgentTimer) return;
  const tick = async () => {
    if (runtime.exitcheckAgentBusy) return;
    runtime.exitcheckAgentBusy = true;
    try {
      const store = agentStore(),
        provider = new JupiterProvider();
      for (const plan of await store.active()) {
        if (plan.lastPoll !== null && Date.now() - plan.lastPoll < 15000)
          continue;
        await collectAgentPlan(store, plan, (path) => provider.request(path));
      }
    } catch {
      console.error(JSON.stringify({ event: "agent_collector_failed" }));
    } finally {
      runtime.exitcheckAgentBusy = false;
    }
  };
  runtime.exitcheckAgentTimer = setInterval(() => void tick(), 30000);
  runtime.exitcheckAgentTimer.unref();
  void tick();
}
