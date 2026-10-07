import { z } from "zod";
import { endpoint } from "@/lib/http";
import { address } from "@/lib/provider/schemas";
import { JupiterProvider } from "@/lib/provider/jupiter";
import {
  loadHistory,
  historyCoverage,
} from "@/features/traders/history-loader";
import { copyability } from "@/features/traders/copyability";
import { shadowStore } from "@/features/copy-trading/shadow-store";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const q = new URL(request.url).searchParams;
    const owner = address.parse(q.get("owner"));
    const budget = z
      .string()
      .regex(/^\d{1,13}$/)
      .refine((x) => BigInt(x) >= 100000000n && BigInt(x) <= 1000000000000n)
      .parse(q.get("budget") ?? "100000000");
    const sample = await loadHistory(owner, (path) =>
      new JupiterProvider().request(path),
    );
    const observations = (await shadowStore().observations(owner)).filter(
      (o) => o.trade.action === "buy",
    );
    const fresh = observations.filter((o) => {
      const price = o.quote
        ? o.trade.side === "yes"
          ? o.quote.yes
          : o.quote.no
        : null;
      return (
        o.quote &&
        o.observedAt - o.quote.retrievedAt >= 0 &&
        o.observedAt - o.quote.retrievedAt <= 20000 &&
        o.quote.status === "open" &&
        !o.quote.result &&
        o.quote.closeTime * 1000 > o.observedAt &&
        ["polymarket", "gx"].includes(o.quote.provider) &&
        price !== null &&
        BigInt(price) > 0n &&
        BigInt(price) < 1000000n
      );
    });
    return {
      owner,
      coverage: historyCoverage(owner, sample),
      ...copyability(sample, budget),
      prospective: {
        observedBuys: observations.length,
        withIndicativeQuote: fresh.length,
        withinTwoMinutes: observations.filter((o) => o.delayMs <= 120000)
          .length,
        from: observations.length
          ? Math.min(...observations.map((o) => o.observedAt))
          : null,
        to: observations.length
          ? Math.max(...observations.map((o) => o.observedAt))
          : null,
      },
      warning:
        "Observed buys are sampled across background sessions, at most 300 recent signals per wallet and 30 days. Missing signals and historical inventory are unknown. An indicative quote does not prove a fill; fees, depth and reliable holding duration remain unverified.",
    };
  });
}
