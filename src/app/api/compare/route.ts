import { z } from "zod";
import { endpoint } from "@/lib/http";
import { address, positionSchema } from "@/lib/provider/schemas";
import { JupiterProvider } from "@/lib/provider/jupiter";
import {
  loadHistory,
  historyCoverage,
  type HistorySample,
} from "@/features/traders/history-loader";
import { replay, strategies } from "@/features/backtesting/backtest";
import { summarizeOverlap, type Exposure } from "@/features/traders/overlap";
import { AppError } from "@/lib/errors";
export const runtime = "nodejs";
const posCache = new Map<
  string,
  {
    at: number;
    rows: Exposure[];
    complete: boolean;
    unknownEvents: number;
    reason: string;
  }
>();
const posSchema = positionSchema.extend({
  eventMetadata: z
    .object({ eventId: z.string().min(1), title: z.string() })
    .nullable()
    .optional(),
});
async function exposures(owner: string, api: JupiterProvider) {
  const hit = posCache.get(owner);
  if (hit && Date.now() - hit.at < 60000) return hit;
  const rows: Exposure[] = [];
  let start = 0,
    complete = false,
    unknownEvents = 0,
    reason = "Position page limit reached";
  try {
    for (let page = 0; page < 3; page++) {
      const j = z
        .object({
          data: z.array(posSchema),
          pagination: z
            .object({ end: z.number().int(), hasNext: z.boolean() })
            .optional(),
        })
        .parse(
          await api.request(
            "/positions?" +
              new URLSearchParams({
                ownerPubkey: owner,
                start: String(start),
                end: String(start + 100),
              }),
          ),
        );
      if (j.data.some((p) => p.ownerPubkey !== owner))
        throw new AppError("POSITION_OWNER", "Position owner mismatch.", 502);
      for (const p of j.data) {
        if (
          BigInt(p.contractsMicro) === 0n ||
          p.claimed ||
          p.claimable ||
          p.marketMetadata?.result ||
          ["yes", "no", "cancelled"].includes(p.marketMetadata?.status ?? "")
        )
          continue;
        const event = p.eventMetadata?.eventId ?? null;
        if (!event) unknownEvents++;
        rows.push({
          id: p.pubkey,
          owner,
          eventId: event,
          marketId: p.marketId,
          title:
            p.eventMetadata?.title ?? p.marketMetadata?.title ?? p.marketId,
          side: p.isYes ? "yes" : "no",
          value: p.valueUsd,
        });
      }
      if (!j.pagination) {
        reason = "Position pagination metadata unavailable";
        break;
      }
      if (!j.pagination.hasNext) {
        complete = true;
        reason = "Provider reported no more position pages";
        break;
      }
      if (j.pagination.end <= start || j.data.length === 0) {
        reason = "Position cursor stopped advancing";
        break;
      }
      start = j.pagination.end;
    }
  } catch (e) {
    if (e instanceof AppError && e.code === "POSITION_OWNER") throw e;
    reason =
      "Positions unavailable or incomplete; overlap is unknown for this wallet";
  }
  const sample = {
    at: Date.now(),
    rows: [...new Map(rows.map((p) => [p.id, p])).values()],
    complete,
    unknownEvents,
    reason,
  };
  if (posCache.size >= 50) posCache.clear();
  posCache.set(owner, sample);
  return sample;
}
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const url = new URL(request.url),
      owners = z
        .array(address)
        .min(1)
        .max(3)
        .refine((xs) => new Set(xs).size === xs.length)
        .parse(url.searchParams.getAll("owner")),
      budget = z
        .string()
        .regex(/^\d{1,13}$/)
        .refine((x) => BigInt(x) >= 100000000n && BigInt(x) <= 1000000000000n)
        .parse(url.searchParams.get("budget")),
      fee = z.coerce
        .number()
        .int()
        .min(0)
        .max(1000)
        .parse(url.searchParams.get("fee") ?? 100),
      slippage = z.coerce
        .number()
        .int()
        .min(0)
        .max(1000)
        .parse(url.searchParams.get("slippage") ?? 100);
    const api = new JupiterProvider();
    const samples: HistorySample[] = [];
    for (const owner of owners)
      samples.push(await loadHistory(owner, (path) => api.request(path)));
    const available = samples.every((s) => s.from !== null && s.to !== null),
      from = available ? Math.max(...samples.map((s) => s.from!)) : null,
      to = available ? Math.min(...samples.map((s) => s.to!)) : null,
      common = from !== null && to !== null && from <= to;
    const histories = samples.map((s) =>
      s.history.filter(
        (h) => common && h.timestamp >= from! && h.timestamp <= to!,
      ),
    );
    const strategy = strategies[0],
      individual = common
        ? owners.map((owner, i) => ({
            owner,
            coverage: historyCoverage(owner, samples[i]),
            ...replay(
              histories[i],
              budget,
              { ...strategy, callerBps: 7000 },
              fee,
              slippage,
            ),
          }))
        : [];
    const combined = common
      ? replay(
          histories.flat(),
          budget,
          { ...strategy, callerBps: Math.floor(7000 / owners.length) },
          fee,
          slippage,
        )
      : null;
    const current = [];
    for (const owner of owners)
      current.push({ owner, ...(await exposures(owner, api)) });
    return {
      owners,
      budget,
      feeBps: fee,
      slippageBps: slippage,
      from: common ? from : null,
      to: common ? to : null,
      commonWindow: common,
      coverage: owners.map((owner, i) => historyCoverage(owner, samples[i])),
      individual,
      combined,
      overlap: {
        groups: summarizeOverlap(current.flatMap((x) => x.rows)),
        coverage: current.map(({ rows, ...x }) => ({
          ...x,
          openPositions: rows.length,
        })),
        verified: current.every((x) => x.complete && x.unknownEvents === 0),
      },
      warning:
        "Comparison uses the shared observed time range, fresh starting cash, and unvalued open positions. Earlier inventory, follower execution and historical depth are unknown. Current overlap is a snapshot, not a measure of future correlation.",
    };
  });
}
