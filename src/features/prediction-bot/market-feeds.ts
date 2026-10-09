import { z } from "zod";
import { parseProviderJson, JupiterProvider } from "../../lib/provider/jupiter";
import { decimalToMicro } from "../../lib/amounts";

export type FeedMarket = {
  source: "jupiter" | "polymarket" | "kalshi";
  id: string;
  title: string;
  rules: string;
  closesAt: number | null;
  bid: string | null;
  ask: string | null;
  tokenIds: string[];
  outcomes: string[];
  outcome: string | null;
  resolvedResult?: "yes" | "no" | null;
  status: string;
};
export type Feed = {
  source: FeedMarket["source"];
  at: number;
  markets: FeedMarket[];
  error: string | null;
};
const text = z.string();
const price = (v: unknown): string | null => {
  if (typeof v !== "string" || !/^\d+(\.\d{1,6})?$/.test(v)) return null;
  const p = decimalToMicro(v);
  return p > 0n && p < 1000000n ? String(p) : null;
};
const microPrice = (v: unknown): string | null =>
  typeof v === "string" &&
  /^\d+$/.test(v) &&
  BigInt(v) > 0n &&
  BigInt(v) < 1000000n
    ? v
    : null;
const date = (v: unknown): number | null =>
  typeof v === "string" && Number.isFinite(Date.parse(v))
    ? Date.parse(v)
    : null;
const list = (v: unknown): string[] => {
  try {
    return z
      .array(text)
      .max(20)
      .parse(typeof v === "string" ? JSON.parse(v) : v);
  } catch {
    return [];
  }
};
export function parsePolymarket(raw: unknown): FeedMarket[] {
  return z
    .array(
      z.object({
        id: text,
        question: text,
        description: text.default(""),
        endDate: text.optional(),
        outcomes: text,
        clobTokenIds: text.optional(),
        active: z.boolean(),
        closed: z.boolean(),
        bestBid: z.unknown(),
        bestAsk: z.unknown(),
      }),
    )
    .max(100)
    .parse(raw)
    .map((m) => ({
      source: "polymarket",
      id: m.id,
      title: m.question,
      rules: m.description,
      closesAt: date(m.endDate),
      bid: price(m.bestBid),
      ask: price(m.bestAsk),
      tokenIds: list(m.clobTokenIds),
      outcomes: list(m.outcomes),
      outcome: null,
      status: m.active && !m.closed ? "open" : "closed",
    }));
}
export function parseKalshi(raw: unknown): FeedMarket[] {
  return z
    .object({
      markets: z
        .array(
          z.object({
            ticker: text,
            title: text,
            rules_primary: text.default(""),
            rules_secondary: text.default(""),
            close_time: text,
            status: text,
            yes_bid_dollars: text.optional(),
            yes_ask_dollars: text.optional(),
          }),
        )
        .max(100),
    })
    .parse(raw)
    .markets.map((m) => ({
      source: "kalshi",
      id: m.ticker,
      title: m.title,
      rules: [m.rules_primary, m.rules_secondary].filter(Boolean).join("\n\n"),
      closesAt: date(m.close_time),
      bid: price(m.yes_bid_dollars),
      ask: price(m.yes_ask_dollars),
      tokenIds: [],
      outcomes: ["Yes", "No"],
      outcome: "Yes",
      status: m.status === "active" ? "open" : m.status,
    }));
}
export function parseJupiterMarkets(raw: unknown): FeedMarket[] {
  const markets = z
    .object({
      data: z
        .array(
          z.object({
            metadata: z.object({ title: text }).optional(),
            markets: z
              .array(
                z.object({
                  marketId: text,
                  title: text,
                  status: text,
                  result: z.enum(["yes", "no"]).nullable().optional(),
                  provider: text,
                  closeTime: z.number(),
                  rulesPrimary: text.default(""),
                  rulesSecondary: text.default(""),
                  clobTokenIds: z.array(text).optional(),
                  outcomes: z.array(text).optional(),
                  marketOptions: z
                    .array(z.object({ label: text, buyYes: z.boolean() }))
                    .optional(),
                  pricing: z
                    .object({
                      buyYesPriceUsd: z.unknown(),
                      sellYesPriceUsd: z.unknown(),
                    })
                    .optional(),
                }),
              )
              .default([]),
          }),
        )
        .max(100),
    })
    .parse(raw);
  return markets.data.flatMap((e) =>
    e.markets.map((m) => ({
      source: "jupiter" as const,
      id: m.marketId,
      title: [e.metadata?.title, m.title].filter(Boolean).join(" · "),
      rules: [m.rulesPrimary, m.rulesSecondary].filter(Boolean).join("\n\n"),
      closesAt: m.closeTime * 1000,
      bid: microPrice(m.pricing?.sellYesPriceUsd),
      ask: microPrice(m.pricing?.buyYesPriceUsd),
      tokenIds: m.provider === "polymarket" ? (m.clobTokenIds ?? []) : [],
      outcomes: m.outcomes ?? [],
      outcome:
        m.marketOptions?.find((o) => o.buyYes)?.label ??
        (m.outcomes?.[0]?.toLowerCase() === "yes" ? m.outcomes[0] : null),
      status: m.status,
      resolvedResult: m.result ?? null,
    })),
  );
}
// Fixed public origins only; no client-supplied URL, credentials, or trading calls.
export async function publicJson(
  url: string,
  transport: typeof fetch = fetch,
): Promise<unknown> {
  const r = await transport(url, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw Error(`Provider returned HTTP ${r.status}.`);
  const reader = r.body?.getReader();
  if (!reader) throw Error("Provider returned no body.");
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2000000) {
      await reader.cancel();
      throw Error("Provider response exceeds limit.");
    }
    parts.push(value);
  }
  return parseProviderJson(Buffer.concat(parts).toString("utf8"));
}
export async function loadFeed(source: Feed["source"]): Promise<Feed> {
  try {
    const markets =
      source === "jupiter"
        ? parseJupiterMarkets(
            await new JupiterProvider().request(
              "/events?category=crypto&filter=trending&includeMarkets=true&start=0&end=12",
            ),
          )
        : source === "kalshi"
          ? parseKalshi(
              await publicJson(
                "https://external-api.kalshi.com/trade-api/v2/markets?status=open&limit=12&mve_filter=exclude",
              ),
            )
          : parsePolymarket(
              await publicJson(
                "https://gamma-api.polymarket.com/markets?closed=false&active=true&limit=12&order=volume24hr&ascending=false",
              ),
            );
    return { source, at: Date.now(), markets, error: null };
  } catch (e) {
    return {
      source,
      at: Date.now(),
      markets: [],
      error:
        e instanceof Error && /^Provider (returned|response)/.test(e.message)
          ? e.message
          : "Feed unavailable or response failed validation.",
    };
  }
}
const normalize = (s: string) => s.trim().replace(/\s+/g, " ");
export function verifyUnderlying(
  route: FeedMarket,
  external: FeedMarket,
): { verified: boolean; independent: boolean; reason: string } {
  const orientation = route.outcomes.indexOf(route.outcome ?? "");
  const same =
    route.source === "jupiter" &&
    external.source === "polymarket" &&
    orientation >= 0 &&
    route.tokenIds.length === 2 &&
    route.outcomes.length === 2 &&
    external.outcomes.length === 2 &&
    external.tokenIds.length === 2 &&
    route.tokenIds.every((id, i) => id === external.tokenIds[i]) &&
    route.outcomes.every((label, i) => label === external.outcomes[i]) &&
    !!route.rules.trim() &&
    normalize(route.rules) === normalize(external.rules);
  return {
    verified: same,
    independent: false,
    reason: same
      ? "Exact outcome tokens, labels and rules match. Same underlying venue; not an independent probability signal."
      : "Outcome identity or settlement rules are not verified. Comparison cannot trigger a trade.",
  };
}
export async function underlyingMarket(
  route: FeedMarket,
): Promise<FeedMarket | null> {
  const match = /^POLY-(\d+)(?:-[01])?$/.exec(route.id);
  if (!match) return null;
  const raw = await publicJson(
    `https://gamma-api.polymarket.com/markets/${match[1]}`,
  );
  return parsePolymarket([raw])[0];
}
export async function refreshRoute(route: FeedMarket): Promise<FeedMarket> {
  const raw = await new JupiterProvider().request(
    `/markets/${encodeURIComponent(route.id)}`,
  );
  const parsed = parseJupiterMarkets({ data: [{ markets: [raw] }] })[0];
  return { ...parsed, title: route.title };
}
