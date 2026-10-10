import { z } from "zod";
import { AppError } from "@/lib/errors";
import { readLimitedText } from "@/lib/read-limited-text";
import { marketItemSchema, type MarketItem } from "./types";
import { sourceImage } from "./image-url";

const origin = "https://live-api.panta.market/api/v1";
const marketAddress = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const timestamp = z.number().int().nonnegative().max(4_102_444_800);
const providerTimestamp = z.union([
  timestamp,
  z
    .string()
    .datetime({ offset: true })
    .transform((value) => Math.floor(Date.parse(value) / 1000))
    .pipe(timestamp),
]);
const probability = z
  .union([
    z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .transform(Number),
    z.number(),
  ])
  .pipe(z.number().finite().min(0).max(1))
  .nullish();
const amount = z
  .union([
    z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .transform(Number),
    z.number(),
  ])
  .pipe(z.number().finite().nonnegative())
  .nullish();
const rowSchema = z.object({
  marketId: marketAddress,
  title: z.string().max(1000).default(""),
  question: z.string().max(1000).optional(),
  resolutionRule: z.string().max(5000).optional(),
  sources: z.array(z.string().max(1000)).max(20).optional(),
  oracle: z.string().max(3000).optional(),
  description: z.string().max(15000).default(""),
  images: z.unknown().optional(),
  category: z.string().max(100),
  phase: z.enum(["primary", "secondary", "resolved", "cancelled"]),
  startTime: providerTimestamp,
  endTime: providerTimestamp,
  resolutionTime: providerTimestamp,
  resolved: z.boolean(),
  status: z.string().max(100),
  yesPrice: probability,
  noPrice: probability,
  volumeUsdc: amount,
  marketType: z.string().max(100).nullish(),
  region: z.string().max(200).nullish(),
  primaryYesPrice: probability,
  primaryNoPrice: probability,
  secondaryYesPrice: probability,
  secondaryNoPrice: probability,
  isGraduated: z.boolean().nullish(),
});
type PantaRow = z.infer<typeof rowSchema>;

async function request(
  path: string,
  key: string,
  transport: typeof fetch,
): Promise<unknown> {
  const response = await transport(`${origin}${path}`, {
    headers: { "X-Api-Key": key },
    signal: AbortSignal.timeout(4000),
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok)
    throw new AppError(
      "PANTA_UNAVAILABLE",
      "Panta market data is unavailable. Check API access or retry shortly.",
      502,
    );
  return JSON.parse(
    await readLimitedText(
      response,
      500_000,
      () =>
        new AppError(
          "PANTA_RESPONSE_TOO_LARGE",
          "Panta response exceeded its size limit.",
          502,
        ),
    ),
  ) as unknown;
}

export function normalizePanta(
  raw: unknown,
  now = Date.now(),
): MarketItem | null {
  const result = rowSchema.safeParse(raw);
  if (!result.success) return null;
  const m = result.data;
  const suppliedQuestion = m.title.trim() || m.question?.trim();
  const question =
    suppliedQuestion ||
    `Panta contract ${m.marketId.slice(0, 6)}…${m.marketId.slice(-4)}`;
  const marketStatus: MarketItem["marketStatus"] =
    m.phase === "cancelled" || m.status === "cancelled"
      ? "cancelled"
      : m.resolved || m.phase === "resolved" || m.status === "resolved"
        ? "resolved"
        : m.endTime * 1000 <= now || m.status === "closed"
          ? "closed"
          : m.startTime * 1000 > now
            ? "upcoming"
            : "open";
  const current = marketStatus === "open" || marketStatus === "upcoming";
  const category: MarketItem["category"] =
    /crypto|bitcoin|ethereum|solana/i.test(m.category)
      ? "Crypto"
      : /macro|politic|econom|finance/i.test(m.category)
        ? "Macro"
        : /tech|science|ai/i.test(m.category)
          ? "Tech"
          : /sport/i.test(m.category)
            ? "Sports"
            : "Other";
  return marketItemSchema.parse({
    id: `panta:${m.marketId}`,
    providerId: m.marketId,
    question,
    imageUrl: Array.isArray(m.images)
      ? (m.images.map(sourceImage).find(Boolean) ?? null)
      : null,
    marketStatus,
    questionAvailable: Boolean(suppliedQuestion),
    isTestContract: /^(?:\[test\]|sandbox test market\b)/i.test(question),
    category,
    source: "solana",
    dataProvider: "panta",
    yesPrice: current ? (m.yesPrice ?? null) : null,
    noPrice: current ? (m.noPrice ?? null) : null,
    volume24h: null,
    liquidity: null,
    pantaDetails: {
      phase: m.phase,
      category: m.category,
      marketType: m.marketType ?? null,
      region: m.region ?? null,
      totalVolumeUsdc: m.volumeUsdc ?? null,
      primaryYesPrice: current ? (m.primaryYesPrice ?? null) : null,
      primaryNoPrice: current ? (m.primaryNoPrice ?? null) : null,
      secondaryYesPrice: current ? (m.secondaryYesPrice ?? null) : null,
      secondaryNoPrice: current ? (m.secondaryNoPrice ?? null) : null,
      isGraduated: m.isGraduated ?? null,
    },
    resolutionDate: new Date(m.resolutionTime * 1000).toISOString(),
    tradingClosesAt: new Date(m.endTime * 1000).toISOString(),
    marketStartsAt: new Date(m.startTime * 1000).toISOString(),
    rules: [m.resolutionRule, m.description, ...(m.sources ?? [])]
      .filter(Boolean)
      .join("\n")
      .slice(0, 15000),
    oracleSource: (
      m.oracle ||
      m.sources?.join(", ") ||
      "See Panta market resolution rules; oracle not supplied by catalog"
    ).slice(0, 300),
    url: "https://panta.market",
    tokenIds: [],
    capturedAt: now,
    tradable:
      marketStatus === "open" &&
      Boolean(suppliedQuestion) &&
      ["open", m.phase].includes(m.status) &&
      (m.yesPrice != null || m.noPrice != null),
    eventKey: `panta-event:${m.marketId}`,
  });
}

export { request as pantaRequest, marketAddress as pantaAddress };

export async function pantaCatalog(
  transport: typeof fetch = fetch,
  key = process.env.PANTA_API_KEY?.trim(),
): Promise<{ markets: MarketItem[]; warnings: string[] }> {
  if (!key)
    return {
      markets: [],
      warnings: [
        "Panta markets are not connected yet. Other feeds remain available.",
      ],
    };
  const pageSchema = z.object({
    items: z.array(z.unknown()).max(50),
    nextCursor: z.string().max(300).nullish(),
  });
  const items: unknown[] = [];
  let cursor: string | null | undefined;
  const seenCursors = new Set<string>();
  let incomplete = false;
  for (let page = 0; page < 4; page++) {
    const query = new URLSearchParams({
      limit: "50",
      ...(cursor ? { cursor } : {}),
    });
    try {
      const catalog = pageSchema.parse(
        await request(`/markets/?${query}`, key, transport),
      );
      items.push(...catalog.items);
      cursor = catalog.nextCursor;
      if (!cursor) break;
      if (seenCursors.has(cursor)) {
        incomplete = true;
        break;
      }
      seenCursors.add(cursor);
    } catch (error) {
      if (!items.length) throw error;
      incomplete = true;
      break;
    }
  }
  // Catalog prices are not live. Fetch detail for at most 20 open contracts,
  // four at a time, keeping total work bounded within the route budget.
  const now = Date.now();
  const rows = items.flatMap((raw) => {
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) return [];
    return [parsed.data];
  });
  const chosen = [...new Map(rows.map((m) => [m.marketId, m])).values()].sort(
    (a, b) => {
      const rank = (m: PantaRow) =>
        !m.resolved &&
        ["primary", "secondary"].includes(m.phase) &&
        m.endTime * 1000 > now
          ? 0
          : 1;
      return rank(a) - rank(b);
    },
  );
  const detailRows = chosen.slice(0, 20);
  const enriched = new Map<string, MarketItem>();
  let failed = false;
  for (let offset = 0; offset < detailRows.length; offset += 4) {
    const results = await Promise.allSettled(
      detailRows.slice(offset, offset + 4).map(async (row: PantaRow) => {
        const raw = await request(`/markets/${row.marketId}/`, key, transport);
        const detail = rowSchema.parse(raw);
        if (detail.marketId !== row.marketId)
          throw Error("Mismatched Panta market");
        return normalizePanta(detail);
      }),
    );
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled") {
        if (result.value) enriched.set(result.value.providerId, result.value);
      } else {
        failed = true;
        const unpriced = normalizePanta({
          ...chosen[offset + i],
          yesPrice: null,
          noPrice: null,
          primaryYesPrice: null,
          primaryNoPrice: null,
          secondaryYesPrice: null,
          secondaryNoPrice: null,
        });
        if (unpriced) enriched.set(unpriced.providerId, unpriced);
      }
    }
    // Avoid hammering an unavailable or throttled provider.
    if (results.every((result) => result.status === "rejected")) break;
  }
  return {
    markets: chosen.flatMap((row) => {
      const market =
        enriched.get(row.marketId) ??
        normalizePanta({
          ...row,
          yesPrice: null,
          noPrice: null,
          primaryYesPrice: null,
          primaryNoPrice: null,
          secondaryYesPrice: null,
          secondaryNoPrice: null,
        });
      return market ? [market] : [];
    }),
    warnings: [
      ...(failed
        ? [
            "Some Panta detail prices are unavailable. Unpriced contracts cannot be paper traded.",
          ]
        : []),
      ...(cursor || incomplete
        ? ["Panta catalog is incomplete. Refresh to retry remaining pages."]
        : []),
      ...(!chosen.length ? ["Panta returned no contracts."] : []),
    ],
  };
}

export async function pantaMarket(id: string): Promise<MarketItem> {
  const address = marketAddress.parse(id.replace(/^panta:/, ""));
  const key = process.env.PANTA_API_KEY?.trim();
  if (!key)
    throw new AppError(
      "PANTA_UNAVAILABLE",
      "Panta details are unavailable.",
      503,
    );
  const raw = rowSchema.parse(
    await request(`/markets/${address}/`, key, fetch),
  );
  if (raw.marketId !== address)
    throw new AppError(
      "PANTA_INVALID_MARKET",
      "Panta returned a different contract.",
      502,
    );
  const market = normalizePanta(raw);
  if (!market)
    throw new AppError(
      "PANTA_INVALID_MARKET",
      "Panta contract details failed validation.",
      502,
    );
  return market;
}
