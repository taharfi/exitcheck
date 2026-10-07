import { z } from "zod";
import { endpoint } from "@/lib/http";
import { JupiterProvider } from "@/lib/provider/jupiter";
import { address, integer } from "@/lib/provider/schemas";
import { traderSchema, tradeSchema } from "@/features/copy-trading/paper";
export const runtime = "nodejs";
const cache = new Map<string, { value: unknown; at: number }>(),
  pending = new Map<string, Promise<unknown>>();
async function read(path: string) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < 60000) return hit;
  const running = pending.get(path);
  if (running)
    return { value: await running, at: cache.get(path)?.at ?? Date.now() };
  const work = new JupiterProvider().request(path);
  pending.set(path, work);
  try {
    const value = await work,
      entry = { value, at: Date.now() };
    if (cache.size > 100) cache.clear();
    cache.set(path, entry);
    return entry;
  } finally {
    pending.delete(path);
  }
}
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const url = new URL(request.url),
      owner = url.searchParams.get("owner");
    if (owner) {
      address.parse(owner);
      const entry = await read("/profiles/" + owner);
      const profile = z
        .object({
          ownerPubkey: address,
          realizedPnlUsd: z.string().regex(/^-?\d+$/),
          totalVolumeUsd: integer,
          predictionsCount: integer,
          correctPredictions: integer,
          wrongPredictions: integer,
          totalPositionsValueUsd: integer,
          totalActiveContractsMicro: integer,
        })
        .parse(entry.value);
      if (profile.ownerPubkey !== owner) throw Error("Owner mismatch");
      return { profile, retrievedAt: entry.at };
    }
    const period = z
      .enum(["weekly", "monthly", "all_time"])
      .parse(url.searchParams.get("period") ?? "monthly");
    const entry = await read(
      "/leaderboards?" +
        new URLSearchParams({ period, metric: "pnl", limit: "100" }),
    );
    const rows = z
      .object({
        data: z.array(
          traderSchema.extend({
            ownerPubkey: address,
            period: z.string(),
            periodStart: z.string().nullable(),
            periodEnd: z.string().nullable(),
          }),
        ),
      })
      .parse(entry.value);
    let activity: ReturnType<typeof tradeSchema.parse>[] = [];
    let activityAvailable = true;
    try {
      const trades = await read("/trades");
      activity = z
        .object({ data: z.array(tradeSchema) })
        .parse(trades.value).data;
    } catch {
      activityAvailable = false;
    }
    return {
      traders: rows.data,
      period,
      retrievedAt: entry.at,
      activity,
      activityAvailable,
      coverage:
        "Up to 100 provider-ranked wallets. This is not every profitable wallet. Recent activity is a limited sampled feed.",
    };
  });
}
