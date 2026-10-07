import { z } from "zod";
import { endpoint } from "@/lib/http";
import { address } from "@/lib/provider/schemas";
import { JupiterProvider } from "@/lib/provider/jupiter";
import {
  replay,
  strategies,
  type History,
} from "@/features/backtesting/backtest";
export const runtime = "nodejs";
import {
  loadHistory,
  historyCoverage,
} from "@/features/traders/history-loader";
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const url = new URL(request.url),
      owners = z
        .array(address)
        .min(1)
        .max(3)
        .refine((x) => new Set(x).size === x.length)
        .parse(url.searchParams.getAll("owner")),
      budget = z
        .string()
        .regex(/^\d+$/)
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
    const api = new JupiterProvider(),
      all: History[] = [],
      coverage = [];
    for (const owner of owners) {
      const sample = await loadHistory(owner, (path) => api.request(path));
      all.push(...sample.history);
      coverage.push(historyCoverage(owner, sample));
    }
    const times = all.map((h) => h.timestamp),
      sorted = [...all].sort((a, b) => a.timestamp - b.timestamp),
      cut = sorted.length
        ? sorted[Math.floor(sorted.length * 0.7)].timestamp
        : null;
    return {
      coverage,
      from: times.length ? Math.min(...times) : null,
      to: times.length ? Math.max(...times) : null,
      budget,
      feeBps: fee,
      slippageBps: slippage,
      cut,
      results: strategies.map((preset) => {
        const s = {
          ...preset,
          callerBps: Math.floor((10000 - preset.reserveBps) / owners.length),
        };
        return {
          ...replay(all, budget, s, fee, slippage),
          training: replay(
            all.filter((h) => cut !== null && h.timestamp < cut),
            budget,
            s,
            fee,
            slippage,
          ).realizedPnl,
          holdout: replay(
            all.filter((h) => cut !== null && h.timestamp >= cut),
            budget,
            s,
            fee,
            slippage,
          ).realizedPnl,
        };
      }),
      warning:
        "Selected-wallet replay, not a validated strategy ranking. Leader fill prices are proxies; follower latency and historical depth are unknown. Open positions are unvalued. Current leaderboard selection introduces survivorship and hindsight bias. Training and holdout are independent portfolios with no carried holdings.",
    };
  });
}
