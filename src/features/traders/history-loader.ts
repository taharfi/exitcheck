import { z } from "zod";
import { historySchema, type History } from "../backtesting/backtest";
import { AppError } from "../../lib/errors";
export type HistorySample = {
  at: number;
  history: History[];
  complete: boolean;
  stopReason: string;
  pages: number;
  reportedTotal: number | null;
  from: number | null;
  to: number | null;
};
type Request = (path: string) => Promise<unknown>;
export async function importHistory(
  owner: string,
  request: Request,
): Promise<HistorySample> {
  const rows = new Map<string, History>();
  let start = 0,
    complete = false,
    pages = 0,
    reportedTotal: number | null = null,
    stopReason = "Three-page limit reached";
  for (let page = 0; page < 3; page++) {
    let data;
    try {
      data = z
        .object({
          data: z.array(historySchema),
          pagination: z.object({
            end: z.number().int().nonnegative(),
            total: z.number().int().nonnegative().optional(),
            hasNext: z.boolean(),
          }),
        })
        .parse(
          await request(
            "/history?" +
              new URLSearchParams({
                ownerPubkey: owner,
                start: String(start),
                end: String(start + 100),
              }),
          ),
        );
      if (data.data.some((h) => h.ownerPubkey !== owner))
        throw new AppError(
          "HISTORY_OWNER",
          "History owner could not be verified.",
          502,
        );
    } catch (e) {
      if (
        rows.size === 0 ||
        !(e instanceof AppError) ||
        e.code === "HISTORY_OWNER"
      )
        throw e;
      stopReason =
        "Later page unavailable (" +
        e.code +
        "); retaining verified earlier events";
      break;
    }
    pages++;
    reportedTotal = data.pagination.total ?? reportedTotal;
    for (const h of data.data) rows.set(h.ownerPubkey + ":" + h.id, h);
    if (!data.pagination.hasNext) {
      complete = true;
      stopReason = "Provider reported no more pages";
      break;
    }
    if (data.pagination.end <= start || data.data.length === 0) {
      stopReason =
        "Provider pagination stopped advancing while reporting more events";
      break;
    }
    start = data.pagination.end;
  }
  const history = [...rows.values()],
    times = history.map((h) => h.timestamp);
  return {
    at: Date.now(),
    history,
    complete,
    stopReason,
    pages,
    reportedTotal,
    from: times.length ? Math.min(...times) : null,
    to: times.length ? Math.max(...times) : null,
  };
}
const cache = new Map<string, HistorySample>(),
  pending = new Map<string, Promise<HistorySample>>();
export async function loadHistory(owner: string, request: Request) {
  const hit = cache.get(owner);
  if (hit && Date.now() - hit.at < 600000) return hit;
  const running = pending.get(owner);
  if (running) return running;
  const work = importHistory(owner, request).then((sample) => {
    if (cache.size >= 50) cache.clear();
    cache.set(owner, sample);
    return sample;
  });
  pending.set(owner, work);
  try {
    return await work;
  } finally {
    pending.delete(owner);
  }
}
export function historyCoverage(owner: string, sample: HistorySample) {
  return {
    owner,
    events: sample.history.length,
    complete: sample.complete,
    stopReason: sample.stopReason,
    retrievedAt: sample.at,
    pages: sample.pages,
    reportedTotal: sample.reportedTotal,
    from: sample.from,
    to: sample.to,
  };
}
