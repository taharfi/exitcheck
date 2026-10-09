import { z } from "zod";
import { decimalToMicro, SCALE } from "@/lib/amounts";
import {
  marketItemSchema,
  type MarketItem,
  type ResearchResult,
} from "./types";
import { assertFresh } from "@/features/exits/calculations";
import type { Estimate } from "@/features/exits/types";
const units = z.string().regex(/^\d{1,16}$/);
export const INITIAL_PAPER_CASH = "10000000000";
export const STORAGE_KEY = "exitcheck.trade.paper.v1";
export const paperPositionSchema = z.object({
  id: z.string().max(100),
  marketId: z.string().max(150),
  question: z.string().max(1000),
  side: z.enum(["YES", "NO"]),
  shares: units,
  entryPrice: units,
  cost: units,
  openedAt: z.number().int(),
  receipt: z
    .object({
      market: marketItemSchema,
      thesis: z.string().max(3000),
      citations: z
        .array(
          z
            .string()
            .url()
            .refine((v) => new URL(v).protocol === "https:"),
        )
        .max(12),
      model: z.string().max(100),
      feeAssumption: z.enum(["excluded", "modelled"]),
      feeBps: z.number().int().min(0).max(500).default(0),
    })
    .optional(),
});
const journalEntry = z.object({
  id: z.string().max(100),
  positionId: z.string().max(100),
  marketId: z.string().max(150),
  question: z.string().max(1000),
  side: z.enum(["YES", "NO"]),
  kind: z.enum(["close", "settle"]),
  shares: units,
  costBasis: units,
  proceeds: units,
  at: z.number().int(),
  source: z.string().max(300),
  receipt: paperPositionSchema.shape.receipt,
});
export const paperAccountSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    cash: units,
    killed: z.boolean(),
    positions: z.array(paperPositionSchema).max(100),
    journal: z.array(journalEntry).max(1000).default([]),
    feeBps: z.number().int().min(0).max(500).default(0),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (
      BigInt(a.cash) +
        a.positions.reduce((sum, p) => sum + BigInt(p.cost), 0n) !==
        BigInt(INITIAL_PAPER_CASH) +
          a.journal.reduce(
            (sum, e) => sum + BigInt(e.proceeds) - BigInt(e.costBasis),
            0n,
          ) ||
      a.positions.some(
        (p) =>
          BigInt(p.shares) === 0n ||
          BigInt(p.entryPrice) === 0n ||
          BigInt(p.entryPrice) > SCALE ||
          BigInt(p.cost) === 0n,
      ) ||
      new Set(a.positions.map((p) => p.id)).size !== a.positions.length ||
      new Set(a.journal.map((e) => e.id)).size !== a.journal.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid paper ledger. Reset it before trading.",
      });
  });
export type PaperAccount = z.infer<typeof paperAccountSchema>;
export type PaperPosition = z.infer<typeof paperPositionSchema>;
export function emptyPaperAccount(): PaperAccount {
  return {
    version: 1,
    revision: 0,
    cash: INITIAL_PAPER_CASH,
    killed: false,
    positions: [],
    journal: [],
    feeBps: 0,
  };
}
export function paperQuote(
  market: MarketItem,
  side: "YES" | "NO",
  sharesText: string,
  limitText: string,
  now = Date.now(),
  feeBps = 0,
) {
  z.number().int().min(0).max(500).parse(feeBps);
  const price = side === "YES" ? market.yesPrice : market.noPrice;
  if (!market.tradable || price === null || price <= 0 || price >= 1)
    throw Error("This outcome has no available live price.");
  if (
    Date.parse(market.resolutionDate) <= now ||
    now - market.capturedAt > 60000 ||
    market.capturedAt > now + 1000
  )
    throw Error("Market snapshot expired. Refresh before ordering.");
  const shares = decimalToMicro(sharesText),
    limit = decimalToMicro(limitText);
  if (
    shares <= 0n ||
    shares > 1000000n * SCALE ||
    limit <= 0n ||
    limit >= SCALE
  )
    throw Error("Enter positive shares and a limit between $0 and $1.");
  const mark = BigInt(Math.round(price * 1000000));
  const fillPrice = (mark * 10005n + 9999n) / 10000n;
  if (fillPrice > limit || fillPrice >= SCALE)
    throw Error(
      "Limit does not cover the price plus 0.05% simulated slippage.",
    );
  const gross = (fillPrice * shares + SCALE - 1n) / SCALE;
  const fee = (gross * BigInt(feeBps) + 9999n) / 10000n;
  const cost = gross + fee;
  return {
    shares: shares.toString(),
    fillPrice: fillPrice.toString(),
    cost: cost.toString(),
    payout: shares.toString(),
    fee: fee.toString(),
  };
}
export function executePaperOrder(
  account: PaperAccount,
  market: MarketItem,
  side: "YES" | "NO",
  shares: string,
  limit: string,
  approved: boolean,
  id: string,
  now = Date.now(),
  research?: ResearchResult,
): PaperAccount {
  account = paperAccountSchema.parse(account);
  if (account.killed) throw Error("Emergency kill switch is armed.");
  if (!approved) throw Error("Confirm human approval for this paper order.");
  if (account.positions.length >= 100)
    throw Error("Paper position limit reached.");
  if (
    account.positions.some((p) => p.id === id) ||
    account.journal.some((e) => e.positionId === id)
  )
    throw Error("This order has already been recorded.");
  const quote = paperQuote(market, side, shares, limit, now, account.feeBps),
    cost = BigInt(quote.cost);
  const invested = account.positions.reduce(
    (sum, p) => sum + BigInt(p.cost),
    0n,
  );
  const marketCost = account.positions
    .filter((p) => p.marketId === market.id)
    .reduce((sum, p) => sum + BigInt(p.cost), 0n);
  if (cost > BigInt(account.cash)) throw Error("Insufficient paper balance.");
  if (marketCost + cost > 200000000n)
    throw Error("Risk cap: at most $200 invested in one market.");
  const groupCost = account.positions
    .filter(
      (p) => market.eventKey && p.receipt?.market.eventKey === market.eventKey,
    )
    .reduce((sum, p) => sum + BigInt(p.cost), 0n);
  if (market.eventKey && groupCost + cost > 300000000n)
    throw Error(
      "Related-event risk cap: at most $300 across outcomes of the same event.",
    );
  if (invested + cost > 2000000000n)
    throw Error("Risk cap: at most $2,000 invested across markets.");
  return paperAccountSchema.parse({
    ...account,
    revision: account.revision + 1,
    cash: (BigInt(account.cash) - cost).toString(),
    positions: [
      ...account.positions,
      {
        id,
        marketId: market.id,
        question: market.question,
        side,
        shares: quote.shares,
        entryPrice: quote.fillPrice,
        cost: quote.cost,
        openedAt: now,
        receipt: {
          market,
          thesis:
            research?.marketId === market.id
              ? [...research.bullThesis, ...research.bearThesis]
                  .join("\n")
                  .slice(0, 3000)
              : "Manual paper decision; no research attached.",
          citations:
            research?.marketId === market.id
              ? research.citations.map((c) => c.url)
              : [],
          model: research?.marketId === market.id ? research.mode : "manual",
          feeAssumption: account.feeBps ? "modelled" : "excluded",
          feeBps: account.feeBps,
        },
      },
    ],
  });
}

export function realizePaperPosition(
  account: PaperAccount,
  positionId: string,
  event: {
    id: string;
    shares: string;
    proceeds: string;
    kind: "close" | "settle";
    source: string;
  },
  approved: boolean,
  now = Date.now(),
): PaperAccount {
  account = paperAccountSchema.parse(account);
  if (account.killed || !approved)
    throw Error("Approve the paper action and disarm the kill switch first.");
  if (account.journal.length >= 1000)
    throw Error("Journal limit reached. Export your journal first.");
  if (account.journal.some((e) => e.id === event.id))
    throw Error("This paper action is already recorded.");
  const p = account.positions.find((p) => p.id === positionId);
  if (!p) throw Error("Paper position is no longer open.");
  const shares = BigInt(units.parse(event.shares)),
    proceeds = BigInt(units.parse(event.proceeds)),
    held = BigInt(p.shares);
  if (shares <= 0n || shares > held || proceeds > shares)
    throw Error("Invalid paper fill quantity or proceeds.");
  const costBasis =
    shares === held ? BigInt(p.cost) : (BigInt(p.cost) * shares) / held;
  return paperAccountSchema.parse({
    ...account,
    revision: account.revision + 1,
    cash: (BigInt(account.cash) + proceeds).toString(),
    positions:
      shares === held
        ? account.positions.filter((x) => x.id !== p.id)
        : account.positions.map((x) =>
            x.id === p.id
              ? {
                  ...p,
                  shares: (held - shares).toString(),
                  cost: (BigInt(p.cost) - costBasis).toString(),
                }
              : x,
          ),
    journal: [
      ...account.journal,
      {
        ...event,
        positionId,
        marketId: p.marketId,
        question: p.question,
        side: p.side,
        costBasis: costBasis.toString(),
        at: now,
        receipt: p.receipt,
      },
    ],
  });
}

export function closePaperPosition(
  account: PaperAccount,
  positionId: string,
  estimate: Estimate,
  approved: boolean,
  id: string,
  now = Date.now(),
): PaperAccount {
  assertFresh(estimate.capturedAt, now);
  const p = account.positions.find((p) => p.id === positionId);
  if (!p || estimate.requested !== p.shares || BigInt(estimate.fillable) === 0n)
    throw Error("No matching fresh exit depth for this position.");
  return realizePaperPosition(
    account,
    positionId,
    {
      id,
      shares: estimate.fillable,
      proceeds: (
        (BigInt(estimate.gross) * BigInt(10000 - (p.receipt?.feeBps ?? 0))) /
        10000n
      ).toString(),
      kind: "close",
      source: `Live bid depth at ${new Date(estimate.capturedAt).toISOString()}; paper fee ${((p.receipt?.feeBps ?? 0) / 100).toFixed(2)}%, actual fees unknown`,
    },
    approved,
    now,
  );
}
