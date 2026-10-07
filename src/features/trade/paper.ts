import { z } from "zod";
import { decimalToMicro, SCALE } from "@/lib/amounts";
import type { MarketItem } from "./types";
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
});
export const paperAccountSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    cash: units,
    killed: z.boolean(),
    positions: z.array(paperPositionSchema).max(100),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (
      BigInt(a.cash) +
        a.positions.reduce((sum, p) => sum + BigInt(p.cost), 0n) !==
        BigInt(INITIAL_PAPER_CASH) ||
      a.positions.some(
        (p) =>
          BigInt(p.shares) === 0n ||
          BigInt(p.entryPrice) === 0n ||
          BigInt(p.entryPrice) > SCALE ||
          BigInt(p.cost) === 0n,
      ) ||
      new Set(a.positions.map((p) => p.id)).size !== a.positions.length
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
  };
}
export function paperQuote(
  market: MarketItem,
  side: "YES" | "NO",
  sharesText: string,
  limitText: string,
  now = Date.now(),
) {
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
  const cost = (fillPrice * shares + SCALE - 1n) / SCALE;
  return {
    shares: shares.toString(),
    fillPrice: fillPrice.toString(),
    cost: cost.toString(),
    payout: shares.toString(),
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
): PaperAccount {
  paperAccountSchema.parse(account);
  if (account.killed) throw Error("Emergency kill switch is armed.");
  if (!approved) throw Error("Confirm human approval for this paper order.");
  if (account.positions.length >= 100)
    throw Error("Paper position limit reached.");
  if (account.positions.some((p) => p.id === id))
    throw Error("This order has already been recorded.");
  const quote = paperQuote(market, side, shares, limit, now),
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
      },
    ],
  });
}
