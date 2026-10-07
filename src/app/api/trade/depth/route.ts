import { z } from "zod";
import { endpoint, body } from "@/lib/http";
import { knownMarket, publicJson } from "@/features/trade/markets";
import { calculateExit } from "@/features/exits/calculations";
import { decimalToMicro } from "@/lib/amounts";
import { AppError } from "@/lib/errors";
import type { Depth } from "@/features/exits/types";
import { JupiterProvider } from "@/lib/provider/jupiter";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const input = z
      .object({
        marketId: z.string().max(150),
        side: z.enum(["YES", "NO"]),
        quantity: z.string().regex(/^\d{1,16}$/),
      })
      .strict()
      .parse(await body(request));
    const m = await knownMarket(input.marketId),
      isYes = input.side === "YES";
    let depth: Depth;
    if (m.source === "polymarket" && m.dataProvider === "jupiter") {
      depth = await new JupiterProvider().depth(m.providerId);
    } else if (m.source === "polymarket") {
      const token = m.tokenIds[isYes ? 0 : 1];
      if (!token || !/^\d{1,100}$/.test(token))
        throw new AppError(
          "NO_DEPTH",
          "This market has no verified outcome orderbook identifier.",
          422,
        );
      const level = z.object({
        price: z.string().regex(/^\d+(\.\d{1,6})?$/),
        size: z.string().regex(/^\d+(\.\d{1,6})?$/),
      });
      const book = z
        .object({ asset_id: z.literal(token), bids: z.array(level).max(10000) })
        .parse(
          await publicJson(
            `https://clob.polymarket.com/book?token_id=${token}`,
          ),
        );
      const bids = book.bids.map((l) => ({
        price: decimalToMicro(l.price).toString(),
        quantity: decimalToMicro(l.size).toString(),
      }));
      depth = {
        yes: isYes ? bids : [],
        no: isYes ? [] : bids,
        capturedAt: Date.now(),
      };
    } else {
      // Native outcome-token swaps do not share the keeper market bid-depth format.
      throw new AppError(
        "NO_DEPTH",
        "Forecast uses swap liquidity. A verified exit quote is not available in this preview yet.",
        422,
      );
    }
    return {
      marketId: m.id,
      side: input.side,
      paper: true,
      estimate: calculateExit({
        quantity: input.quantity,
        held: input.quantity,
        isYes,
        depth,
        referencePrice:
          (isYes ? m.yesPrice : m.noPrice) === null
            ? null
            : String(Math.round((isYes ? m.yesPrice! : m.noPrice!) * 1000000)),
      }),
      notice:
        "Live bid-depth estimate using ExitCheck's exit calculator. Fees are unknown; this does not close your paper position or execute a trade.",
    };
  });
}
