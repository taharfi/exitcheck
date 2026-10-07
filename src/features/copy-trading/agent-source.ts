import { createHash } from "node:crypto";
import { z } from "zod";
import { address, integer } from "@/lib/provider/schemas";
import { AppError } from "@/lib/errors";
import type { AgentPlan } from "./agent-model";

const base = z.object({
  id: z.string().regex(/^[1-9]\d{0,29}$/),
  ownerPubkey: address,
  eventType: z.string().min(1).max(80),
  timestamp: z.number().int().nonnegative().max(8_640_000_000_000),
});
const fill = base.extend({
  eventType: z.literal("order_filled"),
  marketId: z.string().min(1).max(200),
  eventId: z.string().min(1).max(200),
  isBuy: z.boolean(),
  isYes: z.boolean(),
  filledContractsMicro: integer,
  avgFillPriceUsd: integer,
  signature: z
    .string()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{64,100}$/)
    .nullable()
    .optional(),
  eventMetadata: z
    .object({ title: z.string().max(500) })
    .nullable()
    .optional(),
  marketMetadata: z
    .object({ title: z.string().max(500) })
    .nullable()
    .optional(),
});
export type AgentFill = z.infer<typeof fill>;
type Event = z.infer<typeof base> | AgentFill;
export type AgentRequest = (path: string) => Promise<unknown>;
const pageSchema = z.object({
  data: z.array(z.unknown()).max(100),
  pagination: z.object({
    end: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    hasNext: z.boolean(),
  }),
});
function fingerprint(event: Event) {
  const stable =
    "marketId" in event
      ? {
          ...base.parse(event),
          marketId: event.marketId,
          eventId: event.eventId,
          isBuy: event.isBuy,
          isYes: event.isYes,
          quantity: event.filledContractsMicro,
          price: event.avgFillPriceUsd,
          signature: event.signature ?? null,
        }
      : base.parse(event);
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export type AgentActivitySample = {
  trader: string;
  retrievedAt: number;
  sampledEvents: number;
  buys: number;
  sells: number;
  excludedFills: number;
  hasMoreEvents: boolean;
  lastFillAt: number | null;
  recentFills: {
    id: string;
    marketId: string;
    title: string;
    action: "buy" | "sell";
    side: "yes" | "no";
    at: number;
    price: string;
    quantity: string;
  }[];
};

/** A one-page public preview, separate from the collector's activation boundary. */
export async function readAgentActivity(
  trader: string,
  request: AgentRequest,
  clock = Date.now,
): Promise<AgentActivitySample> {
  address.parse(trader);
  const result = pageSchema.parse(
    await request(
      "/history?" +
        new URLSearchParams({
          ownerPubkey: trader,
          start: "0",
          end: "100",
        }),
    ),
  );
  const seen = new Map<string, string>();
  const fills: AgentFill[] = [];
  let previousId: bigint | null = null;
  for (const raw of result.data) {
    const header = base.parse(raw);
    if (header.ownerPubkey !== trader)
      throw new AppError(
        "HISTORY_OWNER",
        "The returned history does not match the selected trader.",
        502,
      );
    const parsedFill =
      header.eventType === "order_filled" ? fill.parse(raw) : null;
    const event: Event = parsedFill ?? header;
    const hash = fingerprint(event),
      previous = seen.get(event.id);
    if (previous) {
      if (previous !== hash)
        throw new AppError(
          "HISTORY_CHANGED",
          "Repeated history records disagree. Activity could not be verified.",
          502,
        );
      continue;
    }
    if (previousId !== null && BigInt(event.id) >= previousId)
      throw new AppError(
        "HISTORY_ORDER",
        "History is not in the expected order. Activity could not be verified.",
        502,
      );
    seen.set(event.id, hash);
    previousId = BigInt(event.id);
    if (parsedFill) fills.push(parsedFill);
  }
  const now = clock();
  const usable = fills
    .filter(
      (f) =>
        Number.isSafeInteger(f.timestamp * 1000) &&
        f.timestamp * 1000 <= now &&
        BigInt(f.filledContractsMicro) > 0n &&
        BigInt(f.avgFillPriceUsd) > 0n &&
        BigInt(f.avgFillPriceUsd) < 1000000n,
    )
    .sort((a, b) => b.timestamp - a.timestamp);
  return {
    trader,
    retrievedAt: now,
    sampledEvents: seen.size,
    buys: usable.filter((f) => f.isBuy).length,
    sells: usable.filter((f) => !f.isBuy).length,
    excludedFills: fills.length - usable.length,
    hasMoreEvents: result.pagination.hasNext,
    lastFillAt: usable[0] ? usable[0].timestamp * 1000 : null,
    recentFills: usable.slice(0, 5).map((f) => ({
      id: f.id,
      marketId: f.marketId,
      title: f.eventMetadata?.title ?? f.marketMetadata?.title ?? f.marketId,
      action: f.isBuy ? "buy" : "sell",
      side: f.isYes ? "yes" : "no",
      at: f.timestamp * 1000,
      price: f.avgFillPriceUsd,
      quantity: f.filledContractsMicro,
    })),
  };
}
export async function readAgentHistory(
  trader: string,
  cursor: AgentPlan["cursor"],
  request: AgentRequest,
) {
  const seen = new Map<string, string>();
  const fills: AgentFill[] = [];
  let start = 0,
    lastId: bigint | null = null,
    newest: AgentPlan["cursor"] = null;
  for (let page = 0; page < 4; page++) {
    const result = pageSchema.parse(
      await request(
        "/history?" +
          new URLSearchParams({
            ownerPubkey: trader,
            start: String(start),
            end: String(start + 100),
          }),
      ),
    );
    for (const raw of result.data) {
      const header = base.parse(raw);
      if (header.ownerPubkey !== trader)
        throw new AppError(
          "HISTORY_OWNER",
          "Provider returned history for a different wallet. Watching is paused.",
          502,
        );
      const parsedFill =
        header.eventType === "order_filled" ? fill.parse(raw) : null;
      const event: Event = parsedFill ?? header;
      const hash = fingerprint(event),
        id = BigInt(event.id);
      const previous = seen.get(event.id);
      if (previous) {
        if (previous !== hash)
          throw new AppError(
            "HISTORY_CHANGED",
            "A repeated history event changed. Watching is paused.",
            502,
          );
        continue;
      }
      if (lastId !== null && id >= lastId)
        throw new AppError(
          "HISTORY_ORDER",
          "History is not in the expected newest-first order. Watching is paused.",
          502,
        );
      seen.set(event.id, hash);
      lastId = id;
      newest ??= { id: event.id, fingerprint: hash };
      if (cursor && event.id === cursor.id) {
        if (hash !== cursor.fingerprint)
          throw new AppError(
            "HISTORY_CHANGED",
            "The saved history boundary changed. Watching is paused.",
            502,
          );
        return {
          cursor: newest,
          fills: fills.reverse(),
          pages: page + 1,
          baseline: false,
        };
      }
      if (cursor && id < BigInt(cursor.id))
        throw new AppError(
          "HISTORY_GAP",
          "The previous history boundary is missing. Resume to establish a new baseline; missed activity will not be copied.",
          502,
        );
      if (parsedFill) fills.push(parsedFill);
    }
    // First poll establishes a boundary and deliberately proposes no historical fills.
    if (!cursor)
      return {
        cursor: newest ?? { id: "0", fingerprint: "empty" },
        fills: [],
        pages: 1,
        baseline: true,
      };
    if (!result.pagination.hasNext) {
      if (cursor.id === "0")
        return {
          cursor: newest ?? cursor,
          fills: fills.reverse(),
          pages: page + 1,
          baseline: false,
        };
      throw new AppError(
        "HISTORY_GAP",
        "The saved history boundary could not be found. Watching is paused.",
        502,
      );
    }
    if (result.data.length === 0 || result.pagination.end <= start)
      throw new AppError(
        "HISTORY_PAGINATION",
        "History pagination stopped advancing. Watching is paused.",
        502,
      );
    start = result.pagination.end;
  }
  throw new AppError(
    "HISTORY_GAP",
    "History exceeded the four-page continuity limit. Resume to establish a new baseline.",
    502,
  );
}
