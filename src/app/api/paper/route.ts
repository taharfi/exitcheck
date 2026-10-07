import { z } from "zod";
import { endpoint } from "@/lib/http";
import { JupiterProvider } from "@/lib/provider/jupiter";
import { address, integer, marketSchema } from "@/lib/provider/schemas";
import {
  traderSchema,
  tradeSchema,
  type Quote,
} from "@/features/copy-trading/paper";
export const runtime = "nodejs";
const cache = new Map<string, { until: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
async function read(path: string, ttl: number) {
  const hit = cache.get(path);
  if (hit && hit.until > Date.now()) return hit.value;
  const running = pending.get(path);
  if (running) return running;
  const work = new JupiterProvider().request(path).then((value) => {
    if (cache.size > 200) cache.clear();
    cache.set(path, { until: Date.now() + ttl, value });
    return value;
  });
  pending.set(path, work);
  try {
    return await work;
  } finally {
    pending.delete(path);
  }
}
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const url = new URL(request.url),
      owners = z.array(address).max(3).parse(url.searchParams.getAll("owner")),
      markets = z
        .array(z.string().min(1).max(100))
        .max(20)
        .parse(url.searchParams.getAll("market"));
    const board = z
      .object({ data: z.array(traderSchema) })
      .parse(
        await read("/leaderboards?period=weekly&metric=pnl&limit=20", 60000),
      );
    const trades = z
      .object({ data: z.array(tradeSchema) })
      .parse(await read("/trades", 15000));
    const ids = [
        ...new Set([
          ...trades.data
            .filter(
              (t) =>
                owners.includes(t.ownerPubkey) &&
                Date.now() - Number(t.timestamp) * 1000 <= 120000,
            )
            .map((t) => t.marketId),
          ...markets,
        ]),
      ].slice(0, 20),
      quotes: Quote[] = [],
      quoteErrors: string[] = [];
    for (const id of ids) {
      try {
        const raw = await read("/markets/" + encodeURIComponent(id), 10000);
        const m = marketSchema
          .extend({
            pricing: z
              .object({
                buyYesPriceUsd: integer.nullable(),
                buyNoPriceUsd: integer.nullable(),
              })
              .nullable(),
          })
          .parse(raw);
        quotes.push({
          marketId: id,
          status: m.status,
          result: m.result,
          provider: m.provider,
          closeTime: m.closeTime,
          yes: m.pricing?.buyYesPriceUsd ?? null,
          no: m.pricing?.buyNoPriceUsd ?? null,
          retrievedAt:
            (cache.get("/markets/" + encodeURIComponent(id))?.until ??
              Date.now() + 10000) - 10000,
        });
      } catch {
        quoteErrors.push(id);
      }
    }
    return {
      mode: "live-read-only",
      traders: board.data,
      trades: trades.data,
      quotes,
      quoteErrors,
      retrievedAt: Date.now(),
      coverage:
        "Recent sampled trades only. Gaps are possible; historical signals are not replayed.",
    };
  });
}
