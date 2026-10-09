import { z } from "zod";
export const marketItemSchema = z.object({
  id: z.string().min(1).max(150),
  question: z.string().min(1).max(1000),
  category: z.enum(["Crypto", "Macro", "Tech", "Sports", "Other"]),
  source: z.enum(["polymarket", "solana"]),
  dataProvider: z.enum(["gamma", "jupiter", "panta"]),
  yesPrice: z.number().finite().min(0).max(1).nullable(),
  noPrice: z.number().finite().min(0).max(1).nullable(),
  volume24h: z.number().finite().nonnegative().nullable(),
  liquidity: z.number().finite().nonnegative().nullable(),
  resolutionDate: z.string().datetime(),
  tradingClosesAt: z.string().datetime().optional(),
  marketStartsAt: z.string().datetime().optional(),
  isTestContract: z.boolean().optional(),
  marketStatus: z
    .enum(["open", "upcoming", "closed", "resolved", "cancelled"])
    .optional(),
  questionAvailable: z.boolean().optional(),
  rules: z.string().max(15000),
  oracleSource: z.string().max(300),
  url: z
    .string()
    .url()
    .refine((v) => new URL(v).protocol === "https:"),
  capturedAt: z.number().int(),
  tokenIds: z.array(z.string().max(100)).max(2),
  providerId: z.string().max(150),
  tradable: z.boolean(),
  eventKey: z.string().max(200).optional(),
});
export type MarketItem = z.infer<typeof marketItemSchema>;
export const citationSchema = z.object({
  title: z.string().max(300),
  source: z.string().max(200),
  url: z
    .string()
    .url()
    .refine((v) => new URL(v).protocol === "https:"),
  summary: z.string().max(1000),
  reliability: z.number().min(0).max(1),
  capturedAt: z.number().int().optional(),
});
export const researchSchema = z.object({
  marketId: z.string(),
  fairProbability: z.number().min(0.01).max(0.99),
  marketProbability: z.number().min(0).max(1),
  edge: z.number().min(-1).max(1),
  confidence: z.number().min(0).max(1),
  bullThesis: z.array(z.string().max(1500)).max(6),
  bearThesis: z.array(z.string().max(1500)).max(6),
  citations: z.array(citationSchema).max(12),
  whyThisCouldBeWrong: z.string().max(3000),
  nextCheck: z.string().max(400).optional(),
  proposedTrade: z.object({
    action: z.enum(["BUY_YES", "BUY_NO", "PASS"]),
    limitPrice: z.number().min(0).max(1),
    kellyExposureUSD: z.number().min(0).max(200),
  }),
  mode: z.enum(["gemini", "deepseek", "heuristic"]),
  notice: z.string(),
  capturedAt: z.number(),
  agents: z
    .array(
      z.object({
        role: z.string(),
        probability: z.number().min(0.01).max(0.99),
      }),
    )
    .max(3),
  searchSuggestions: z.array(z.string().max(30000)).max(2),
});
export type ResearchResult = z.infer<typeof researchSchema>;
export const marketFeedSchema = z.object({
  markets: z.array(marketItemSchema).max(1300),
  warnings: z.array(z.string()),
  capturedAt: z.number(),
});
export type MarketFeed = z.infer<typeof marketFeedSchema>;
