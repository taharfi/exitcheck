import { z } from "zod";

export const addressSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const quantity = z
  .union([z.string().regex(/^\d+(\.\d+)?$/), z.number().finite().nonnegative()])
  .transform(String);
export const pantaTradeSchema = z.object({
  id: z.union([z.string().max(200), z.number()]).transform(String),
  marketId: addressSchema,
  wallet: addressSchema,
  isPrimary: z.boolean(),
  yesAmount: quantity,
  noAmount: quantity,
  feePaid: quantity.nullish(),
  blockTime: z.number().int().nonnegative().max(4_102_444_800).nullable(),
  signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/),
  quoteAsset: z.string().max(100),
});
export const pantaPositionSchema = z.object({
  marketId: addressSchema,
  category: z.string().max(100).nullable(),
  side: z.enum(["yes", "no"]),
  shares: quantity,
  phase: z.enum(["primary", "secondary", "resolved", "cancelled"]),
  claimable: z.boolean(),
  claimed: z.boolean(),
  outcome: z.enum(["yes", "no"]).nullable(),
});
export const pantaDataSchema = z.object({
  capturedAt: z.number().int(),
  categories: z.array(z.string().max(100)).max(100),
  trades: z.array(pantaTradeSchema).max(50),
  positions: z.array(pantaPositionSchema).max(200),
  warnings: z.array(z.string().max(300)).max(10),
  wallet: addressSchema.optional(),
  marketId: addressSchema.optional(),
});
export type PantaData = z.infer<typeof pantaDataSchema>;
