import { z } from "zod";
import { JupiterProvider } from "@/lib/provider/jupiter";
import { AppError } from "@/lib/errors";
import { readLimitedText } from "@/lib/read-limited-text";
import { address } from "@/lib/provider/schemas";
import { marketItemSchema, type MarketItem, type MarketFeed } from "./types";

export async function publicJson(
  url: string,
  transport: typeof fetch = fetch,
): Promise<unknown> {
  const response = await transport(url, {
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new AppError(
      "MARKET_DATA_UNAVAILABLE",
      "Live market data is temporarily unavailable.",
      502,
    );
  return JSON.parse(
    await readLimitedText(
      response,
      2_000_000,
      () =>
        new AppError(
          "MARKET_DATA_TOO_LARGE",
          "Market response exceeded its size limit.",
          502,
        ),
    ),
  ) as unknown;
}
const list = z.union([
  z
    .string()
    .max(10000)
    .transform((v, ctx) => {
      try {
        return z.array(z.string()).max(10).parse(JSON.parse(v));
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid list" });
        return z.NEVER;
      }
    }),
  z.array(z.string()).max(10),
]);
const numeric = z
  .union([z.string().regex(/^\d+(\.\d+)?$/), z.number().finite().nonnegative()])
  .transform(Number)
  .pipe(z.number().finite().nonnegative());
const gammaSchema = z.object({
  id: z.string(),
  question: z.string().max(1000),
  slug: z.string().max(300),
  active: z.boolean(),
  closed: z.boolean(),
  endDate: z.string(),
  outcomes: list,
  outcomePrices: list,
  clobTokenIds: list.optional(),
  description: z.string().max(15000).default(""),
  category: z.string().nullish(),
  volume24hr: numeric.nullish(),
  liquidityNum: numeric.nullish(),
  liquidity: numeric.nullish(),
  acceptingOrders: z.boolean().optional(),
  resolutionSource: z.string().max(300).nullish(),
});
function category(question: string): MarketItem["category"] {
  if (/bitcoin|btc|ethereum|crypto|solana|\bsol\b|\beth\b/i.test(question))
    return "Crypto";
  if (
    /inflation|interest rate|fed\b|election|president|gdp|econom|recession/i.test(
      question,
    )
  )
    return "Macro";
  if (
    /artificial intelligence|\bai\b|openai|apple|google|nvidia|technology/i.test(
      question,
    )
  )
    return "Tech";
  return "Other";
}
export function normalizeGamma(raw: unknown, now = Date.now()): MarketItem[] {
  return z
    .array(z.unknown())
    .max(100)
    .parse(raw)
    .flatMap((value) => {
      const result = gammaSchema.safeParse(value);
      if (!result.success) return [];
      const m = result.data,
        yes = m.outcomes.findIndex((v) => v.toLowerCase() === "yes"),
        no = m.outcomes.findIndex((v) => v.toLowerCase() === "no");
      if (
        !m.active ||
        m.closed ||
        yes < 0 ||
        no < 0 ||
        m.outcomes.length !== 2 ||
        !Number.isFinite(Date.parse(m.endDate)) ||
        Date.parse(m.endDate) <= now
      )
        return [];
      const prices = m.outcomePrices.map(Number);
      if (
        prices.length !== 2 ||
        prices.some((v) => !Number.isFinite(v) || v < 0 || v > 1)
      )
        return [];
      return [
        marketItemSchema.parse({
          id: `poly:${m.id}`,
          providerId: m.id,
          question: m.question,
          category: category(`${m.category ?? ""} ${m.question}`),
          source: "polymarket",
          dataProvider: "gamma",
          yesPrice: prices[yes],
          noPrice: prices[no],
          volume24h: m.volume24hr ?? null,
          liquidity: m.liquidityNum ?? m.liquidity ?? null,
          resolutionDate: new Date(m.endDate).toISOString(),
          rules: m.description,
          oracleSource: m.resolutionSource || "See Polymarket resolution rules",
          url: `https://polymarket.com/event/${encodeURIComponent(m.slug)}`,
          tokenIds:
            m.clobTokenIds?.length === 2
              ? [m.clobTokenIds[yes], m.clobTokenIds[no]]
              : [],
          capturedAt: now,
          tradable: m.acceptingOrders === true,
        }),
      ];
    });
}
const forecastSchema = z.object({
  marketId: z.string(),
  title: z.string(),
  provider: z.literal("bisonfi"),
  tradable: z.boolean(),
  outcomeMint: address,
  closeTime: z.number().finite(),
  openTime: z.number().finite(),
  status: z.string(),
  pricing: z
    .object({ buyYesPriceUsd: z.string().regex(/^\d+$/).nullable() })
    .nullish(),
});
async function solanaMarkets(): Promise<MarketItem[]> {
  const response = z
    .object({
      data: z
        .array(z.object({ markets: z.array(z.unknown()).default([]) }))
        .max(100),
    })
    .parse(
      await new JupiterProvider().request(
        "/events?provider=bisonfi&category=crypto&filter=live&sortBy=beginAt&sortDirection=desc&includeMarkets=true&start=0&end=25",
      ),
    );
  const now = Date.now();
  return response.data
    .flatMap((e) => e.markets)
    .flatMap((value) => {
      const result = forecastSchema.safeParse(value);
      if (!result.success) return [];
      const m = result.data;
      if (
        !m.tradable ||
        m.status !== "open" ||
        m.openTime * 1000 > now ||
        m.closeTime * 1000 <= now
      )
        return [];
      const price =
        m.pricing?.buyYesPriceUsd == null
          ? null
          : Number(m.pricing.buyYesPriceUsd) / 1000000;
      if (price !== null && (price < 0 || price > 1)) return [];
      // UP and DOWN are separate outcome-token markets; inventing a complementary NO quote is invalid.
      return [
        marketItemSchema.parse({
          id: `sol:${m.marketId}`,
          providerId: m.marketId,
          question: `BTC ${m.title} — Forecast 15-minute round`,
          category: "Crypto",
          source: "solana",
          dataProvider: "jupiter",
          yesPrice: price,
          noPrice: null,
          volume24h: null,
          liquidity: null,
          resolutionDate: new Date(m.closeTime * 1000).toISOString(),
          rules:
            "BTC 15-minute UP/DOWN round. UP wins at or above the opening BTC price; DOWN wins below it. The market ID selects the outcome. Verify this round's terms in Jupiter.",
          oracleSource: "Chainlink BTC/USD • Jupiter Forecast",
          url: "https://developers.jup.ag/docs/prediction/forecast",
          tokenIds: [m.outcomeMint],
          capturedAt: now,
          tradable: true,
        }),
      ];
    });
}
async function jupiterPolymarket(): Promise<MarketItem[]> {
  const mSchema = z.object({
    marketId: z.string().max(140),
    title: z.string().max(1000),
    provider: z.literal("polymarket"),
    status: z.string(),
    result: z.string().nullable(),
    closeTime: z.number().finite(),
    rulesPrimary: z.string().max(5000).nullish(),
    rulesSecondary: z.string().max(5000).nullish(),
    pricing: z
      .object({
        buyYesPriceUsd: z.string().regex(/^\d+$/).nullable(),
        buyNoPriceUsd: z.string().regex(/^\d+$/).nullable(),
      })
      .nullable(),
  });
  const data = z
    .object({
      data: z.array(z.object({ markets: z.array(z.unknown()) })).max(25),
    })
    .parse(
      await new JupiterProvider().request(
        "/events?provider=polymarket&category=crypto&filter=trending&includeMarkets=true&start=0&end=12",
      ),
    );
  const now = Date.now();
  return data.data
    .flatMap((e) => e.markets)
    .flatMap((value) => {
      const r = mSchema.safeParse(value);
      if (!r.success) return [];
      const m = r.data;
      if (m.status !== "open" || m.result !== null || m.closeTime * 1000 <= now)
        return [];
      const price = (v: string | null | undefined) =>
        v == null ? null : Number(v) / 1000000;
      const yes = price(m.pricing?.buyYesPriceUsd),
        no = price(m.pricing?.buyNoPriceUsd);
      if ((yes !== null && yes > 1) || (no !== null && no > 1)) return [];
      return [
        marketItemSchema.parse({
          id: `jup:${m.marketId}`,
          providerId: m.marketId,
          question: m.title,
          category: category(m.title),
          source: "polymarket",
          dataProvider: "jupiter",
          yesPrice: yes,
          noPrice: no,
          volume24h: null,
          liquidity: null,
          resolutionDate: new Date(m.closeTime * 1000).toISOString(),
          rules: [m.rulesPrimary, m.rulesSecondary].filter(Boolean).join("\n"),
          oracleSource: "Polymarket resolution rules • via Jupiter on Solana",
          url: "https://jup.ag/prediction",
          tokenIds: [],
          capturedAt: now,
          tradable: yes !== null || no !== null,
        }),
      ];
    })
    .slice(0, 25);
}
let cached: MarketFeed | null = null,
  pending: Promise<MarketFeed> | null = null;
export async function marketFeed(): Promise<MarketFeed> {
  if (cached && Date.now() - cached.capturedAt < 30000) return cached;
  if (pending) return pending;
  pending = (async () => {
    const results = await Promise.allSettled([
      publicJson(
        "https://gamma-api.polymarket.com/markets?limit=25&active=true&closed=false",
      ).then((v) => normalizeGamma(v)),
      solanaMarkets(),
    ]);
    const warnings: string[] = [],
      markets: MarketItem[] = [];
    results.forEach((r, index) => {
      if (r.status === "fulfilled") markets.push(...r.value);
      else
        warnings.push(
          index === 0
            ? "Polymarket feed unavailable. Retry shortly."
            : "Solana feed unavailable. Check Jupiter access or retry shortly.",
        );
    });
    if (results[0].status === "rejected" || results[0].value.length === 0) {
      try {
        const backup = await jupiterPolymarket();
        markets.unshift(...backup);
        if (backup.length)
          warnings.push(
            "Showing Polymarket quotes through Jupiter on Solana; Gamma is unavailable or returned no current binary markets.",
          );
      } catch {
        /* Provider errors remain explicit; never replace them with invented markets. */
      }
    }
    cached = { markets, warnings, capturedAt: Date.now() };
    return cached;
  })();
  try {
    return await pending;
  } finally {
    pending = null;
  }
}
export async function knownMarket(id: string) {
  const m = (await marketFeed()).markets.find((m) => m.id === id);
  if (!m || Date.parse(m.resolutionDate) <= Date.now())
    throw new AppError(
      "MARKET_UNAVAILABLE",
      "This market is no longer in the live feed. Refresh markets.",
      404,
    );
  return m;
}
