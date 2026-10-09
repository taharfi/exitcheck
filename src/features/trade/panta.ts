import { z } from "zod";
import { AppError } from "@/lib/errors";
import { readLimitedText } from "@/lib/read-limited-text";
import { marketItemSchema, type MarketItem } from "./types";

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
const rowSchema = z.object({
  marketId: marketAddress,
  title: z.string().max(1000).default(""),
  question: z.string().max(1000).optional(),
  resolutionRule: z.string().max(5000).optional(),
  sources: z.array(z.string().max(1000)).max(20).optional(),
  oracle: z.string().max(3000).optional(),
  description: z.string().max(15000).default(""),
  category: z.string().max(100),
  phase: z.enum(["primary", "secondary", "resolved", "cancelled"]),
  startTime: providerTimestamp,
  endTime: providerTimestamp,
  resolutionTime: providerTimestamp,
  resolved: z.boolean(),
  status: z.string().max(100),
  yesPrice: probability,
  noPrice: probability,
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
  const question = m.title.trim() || m.question?.trim();
  if (!question || /^(?:\[test\]|sandbox test market\b)/i.test(question))
    return null;
  if (
    m.resolved ||
    !["primary", "secondary"].includes(m.phase) ||
    !["open", m.phase].includes(m.status) ||
    m.endTime * 1000 <= now ||
    m.resolutionTime < m.endTime
  )
    return null;
  const category: MarketItem["category"] =
    /crypto|bitcoin|ethereum|solana/i.test(m.category)
      ? "Crypto"
      : /macro|politic|econom/i.test(m.category)
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
    category,
    source: "solana",
    dataProvider: "panta",
    yesPrice: m.yesPrice ?? null,
    noPrice: m.noPrice ?? null,
    volume24h: null,
    liquidity: null,
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
      m.startTime * 1000 <= now && (m.yesPrice != null || m.noPrice != null),
    eventKey: `panta-event:${m.marketId}`,
  });
}

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
  let excludedTests = false;
  const rows = items.flatMap((raw) => {
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) return [];
    const m = parsed.data;
    if (
      /^(?:\[test\]|sandbox test market\b)/i.test(
        m.title.trim() || m.question?.trim() || "",
      )
    ) {
      excludedTests = true;
      return [];
    }
    return !m.resolved &&
      ["primary", "secondary"].includes(m.phase) &&
      ["open", m.phase].includes(m.status) &&
      m.endTime * 1000 > now &&
      m.resolutionTime >= m.endTime
      ? [m]
      : [];
  });
  const chosen = [...new Map(rows.map((m) => [m.marketId, m])).values()].slice(
    0,
    20,
  );
  const markets: MarketItem[] = [];
  let failed = false;
  for (let offset = 0; offset < chosen.length; offset += 4) {
    const results = await Promise.allSettled(
      chosen.slice(offset, offset + 4).map(async (row: PantaRow) => {
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
        if (result.value) markets.push(result.value);
      } else {
        failed = true;
        const unpriced = normalizePanta({
          ...chosen[offset + i],
          yesPrice: null,
          noPrice: null,
        });
        if (unpriced) markets.push(unpriced);
      }
    }
    // Avoid hammering an unavailable or throttled provider.
    if (results.every((result) => result.status === "rejected")) break;
  }
  return {
    markets,
    warnings: [
      ...(failed
        ? [
            "Some Panta detail prices are unavailable. Unpriced contracts cannot be paper traded.",
          ]
        : []),
      ...(rows.length > 20 || cursor || incomplete
        ? [
            "Panta discovery is bounded to 200 catalog rows and 20 contract details; the catalog may be incomplete.",
          ]
        : []),
      ...(!markets.length ? ["Panta returned no current open contracts."] : []),
      ...(excludedTests
        ? ["Panta test contracts are excluded from research and paper results."]
        : []),
    ],
  };
}
