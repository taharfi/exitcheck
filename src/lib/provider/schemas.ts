import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { decimalToMicro } from "../amounts";
import type { Depth, Market, Position } from "../../features/exits/types";
export const integer = z.string().regex(/^\d{1,40}$/);
export const address = z.string().refine((v) => {
  try {
    return new PublicKey(v).toBase58() === v;
  } catch {
    return false;
  }
}, "Enter a valid Solana public address.");
export const marketSchema = z.object({
  marketId: z.string().min(1),
  title: z.string(),
  provider: z.string(),
  status: z.string(),
  result: z.enum(["yes", "no"]).nullable(),
  closeTime: z.number().finite(),
});
export const positionSchema = z.object({
  pubkey: address,
  ownerPubkey: address,
  marketId: z.string().min(1),
  isYes: z.boolean(),
  contractsMicro: integer,
  valueUsd: integer.nullable(),
  markPriceUsd: integer.nullable(),
  claimable: z.boolean(),
  claimed: z.boolean(),
  claimedUsd: integer,
  payoutUsd: integer,
  openOrders: z.number().int().nonnegative(),
  marketMetadata: z
    .object({
      title: z.string(),
      status: z.string(),
      result: z.enum(["yes", "no"]).nullable().optional(),
    })
    .nullable(),
});
export function positionState(
  p: Pick<Position, "claimed" | "claimable" | "isYes" | "quantity">,
  m: Market,
): Position["state"] {
  if (!["polymarket", "gx"].includes(m.provider) || m.status === "cancelled")
    return "unsupported";
  if (p.claimed) return "claimed";
  if (m.result !== null) {
    if ((m.result === "yes") !== p.isYes) return "no-payout";
    return p.claimable ? "claimable" : "awaiting-resolution";
  }
  if (m.status === "closed") return "awaiting-resolution";
  if (m.status === "open" && m.closeTime <= Date.now() / 1000)
    return "awaiting-resolution";
  return m.status === "open" ? "open" : "unsupported";
}
export function parsePosition(raw: unknown): Position {
  const p = positionSchema.parse(raw);
  return {
    id: p.pubkey,
    owner: p.ownerPubkey,
    marketId: p.marketId,
    title: p.marketMetadata?.title ?? p.marketId,
    isYes: p.isYes,
    quantity: p.contractsMicro,
    value: p.valueUsd,
    markPrice: p.markPriceUsd,
    claimable: p.claimable,
    claimed: p.claimed,
    claimedUsd: p.claimedUsd,
    payout: p.payoutUsd,
    openOrders: p.openOrders,
    state: "unsupported",
  };
}
const tuple = z.tuple([
  z.string().regex(/^\d+(\.\d{1,6})?$/),
  z.union([z.string(), z.number().finite().nonnegative()]),
]);
export const bookSchema = z.object({
  yes_dollars: z.array(tuple).max(10000),
  no_dollars: z.array(tuple).max(10000),
});
export function parseDepth(raw: unknown, capturedAt = Date.now()): Depth {
  const b = bookSchema.parse(raw);
  const convert = (levels: z.infer<typeof tuple>[]) =>
    levels.map(([price, quantity]) => {
      // Provider numbers are parsed losslessly into decimal strings before this boundary.
      if (typeof quantity === "number" && !Number.isSafeInteger(quantity))
        throw new Error("Fractional depth must be parsed losslessly.");
      const p = decimalToMicro(price);
      if (p > 1_000_000n) throw new Error("Invalid contract price.");
      return {
        price: p.toString(),
        quantity: decimalToMicro(String(quantity)).toString(),
      };
    });
  return { yes: convert(b.yes_dollars), no: convert(b.no_dollars), capturedAt };
}
export const txMetaSchema = z.object({
  blockhash: address,
  lastValidBlockHeight: z.number().int().nonnegative(),
});
export const sellBuildSchema = z.object({
  transaction: z.string().min(20).max(20000),
  txMeta: txMetaSchema,
  executionModel: z.string().nullable().optional(),
  execution: z
    .object({
      endpoint: z.string(),
      context: z.record(z.string(), z.unknown()),
    })
    .optional(),
  order: z.object({
    orderPubkey: address,
    positionPubkey: address,
    userPubkey: address,
    marketId: z.string(),
    isBuy: z.literal(false),
    isYes: z.boolean(),
    contractsMicro: integer,
    minSellPriceUsd: integer.nullable(),
    orderCostUsd: integer,
    estimatedTotalFeeUsd: integer,
  }),
});
export const claimBuildSchema = z.object({
  transaction: z.string().min(20).max(20000),
  txMeta: txMetaSchema,
  position: z.object({
    positionPubkey: address,
    ownerPubkey: address,
    userPubkey: address,
    isYes: z.boolean(),
    contractsMicro: integer,
    payoutAmountUsd: integer,
  }),
});
export const orderStatusSchema = z.object({
  orderPubkey: address,
  status: z.string(),
  latestSignature: z.string().nullable().optional(),
  history: z.array(
    z.object({
      eventType: z.string(),
      status: z.string(),
      signature: z.string(),
      timestamp: z.number(),
    }),
  ),
});
