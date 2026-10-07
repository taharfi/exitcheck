import { z } from "zod";
import { JupiterProvider } from "../../lib/provider/jupiter";
import { integer, marketSchema } from "../../lib/provider/schemas";
import { tradeSchema, evaluatePaper, type Quote, type Trade } from "./paper";
import {
  shadowStore,
  type ShadowStore,
  type Observation,
} from "./shadow-store";
import { AppError } from "../../lib/errors";
export function observation(
  trade: Trade,
  quote: Quote | null,
  now: number,
): Observation {
  const price = quote ? (trade.side === "yes" ? quote.yes : quote.no) : null;
  const leader = BigInt(trade.priceUsd);
  return {
    trade,
    quote,
    observedAt: now,
    delayMs: Math.max(0, now - Number(trade.timestamp) * 1000),
    premiumBps:
      price !== null && leader > 0n
        ? String(((BigInt(price) - leader) * 10000n) / leader)
        : null,
  };
}
export async function collectShadow(
  store: ShadowStore,
  request: (path: string) => Promise<unknown>,
  now = Date.now(),
) {
  const lease = await store.acquire(now);
  if (!lease) return;
  try {
    await store.prune(now);
    const rows = await store.active(now);
    if (!rows.length) return;
    try {
      const trades = z
        .object({ data: z.array(tradeSchema) })
        .parse(await request("/trades")).data;
      const owners = new Set(rows.flatMap((x) => x.paper.owners));
      const selected = trades.filter(
        (t) =>
          owners.has(t.ownerPubkey) && Number(t.timestamp) * 1000 <= now + 5000,
      );
      const ids = [
        ...new Set([
          ...selected
            .filter((t) => now - Number(t.timestamp) * 1000 <= 120000)
            .map((t) => t.marketId),
          ...rows.flatMap((x) =>
            x.paper.positions.filter((p) => !p.settled).map((p) => p.marketId),
          ),
        ]),
      ].slice(0, 10);
      const quotes: Quote[] = [];
      for (const id of ids) {
        try {
          const m = marketSchema
            .extend({
              pricing: z
                .object({
                  buyYesPriceUsd: integer.nullable(),
                  buyNoPriceUsd: integer.nullable(),
                })
                .nullable(),
            })
            .parse(await request("/markets/" + encodeURIComponent(id)));
          quotes.push({
            marketId: id,
            status: m.status,
            result: m.result,
            provider: m.provider,
            closeTime: m.closeTime,
            yes: m.pricing?.buyYesPriceUsd ?? null,
            no: m.pricing?.buyNoPriceUsd ?? null,
            retrievedAt: Date.now(),
          });
        } catch {
          /* Missing quotes produce explicit skip receipts. */
        }
      }
      const finished = Date.now();
      for (const t of selected) {
        if (
          rows.some(
            (x) =>
              x.paper.owners.includes(t.ownerPubkey) &&
              Number(t.timestamp) * 1000 >= x.acceptAfter,
          )
        )
          await store.observe(
            observation(
              t,
              quotes.find((q) => q.marketId === t.marketId) ?? null,
              finished,
            ),
          );
      }
      for (const row of rows) {
        const gap = row.lastSuccess !== null && now - row.lastSuccess > 90000;
        row.paper = evaluatePaper(
          row.paper,
          selected
            .filter((t) => Number(t.timestamp) * 1000 >= row.acceptAfter)
            .map((t) => ({ ...t, id: t.ownerPubkey + ":" + t.id })),
          quotes,
          finished,
        );
        if (gap) row.gaps++;
        row.lastPoll = finished;
        row.lastSuccess = finished;
        row.polls++;
        row.error = null;
        await store.save(row);
      }
    } catch (e) {
      for (const row of rows) {
        row.lastPoll = Date.now();
        row.error = e instanceof AppError ? e.code : "INVALID_FEED";
        await store.save(row);
      }
    }
  } finally {
    await store.release(lease);
  }
}
const runtime = globalThis as typeof globalThis & {
  exitcheckShadowTimer?: ReturnType<typeof setInterval>;
  exitcheckShadowBusy?: boolean;
};
export function startShadowCollector() {
  if (runtime.exitcheckShadowTimer) return;
  const tick = async () => {
    if (runtime.exitcheckShadowBusy) return;
    runtime.exitcheckShadowBusy = true;
    try {
      await collectShadow(shadowStore(), (path) =>
        new JupiterProvider().request(path),
      );
    } catch {
      console.error(JSON.stringify({ event: "shadow_collector_failed" }));
    } finally {
      runtime.exitcheckShadowBusy = false;
    }
  };
  runtime.exitcheckShadowTimer = setInterval(() => void tick(), 30000);
  runtime.exitcheckShadowTimer.unref();
  void tick();
}
