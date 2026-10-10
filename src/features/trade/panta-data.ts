import { z } from "zod";
import { AppError } from "@/lib/errors";
import { pantaRequest } from "./panta";
import {
  addressSchema,
  pantaTradeSchema,
  pantaPositionSchema,
  type PantaData,
} from "./panta-data-types";

// Explicit read-only operations. No account data or arbitrary upstream proxy.
export async function pantaData(
  input: { marketId?: string; wallet?: string },
  transport: typeof fetch = fetch,
  key = process.env.PANTA_API_KEY?.trim(),
): Promise<PantaData> {
  if (!key)
    throw new AppError(
      "PANTA_UNAVAILABLE",
      "Panta data is not connected.",
      503,
    );
  const wallet = input.wallet ? addressSchema.parse(input.wallet) : undefined;
  const marketId = input.marketId
    ? addressSchema.parse(input.marketId)
    : undefined;
  if (Boolean(wallet) === Boolean(marketId))
    throw new AppError(
      "PANTA_QUERY",
      "Choose one market or public wallet.",
      422,
    );
  const result: PantaData = {
    capturedAt: Date.now(),
    categories: [],
    trades: [],
    positions: [],
    warnings: [],
    ...(wallet ? { wallet } : { marketId }),
  };
  const tradePath = wallet
    ? `/wallets/${wallet}/trades/?limit=50`
    : `/markets/${marketId}/trades/?limit=50`;
  const reads = await Promise.allSettled([
    pantaRequest(tradePath, key, transport),
    pantaRequest(
      wallet ? `/positions/?wallet=${wallet}` : "/categories/",
      key,
      transport,
    ),
  ]);
  let available = 0;
  for (const [index, read] of reads.entries()) {
    try {
      if (read.status === "rejected") throw read.reason;
      if (index === 0) {
        const tape = z
          .object({
            wallet: addressSchema.optional(),
            marketId: addressSchema.optional(),
            items: z.array(pantaTradeSchema).max(50),
          })
          .parse(read.value);
        if (
          (wallet &&
            (tape.wallet !== wallet ||
              tape.items.some((t) => t.wallet !== wallet))) ||
          (marketId &&
            (tape.marketId !== marketId ||
              tape.items.some((t) => t.marketId !== marketId)))
        )
          throw Error("Identity mismatch");
        result.trades = tape.items;
      } else if (wallet) {
        const holdings = z
          .object({
            wallet: addressSchema,
            positions: z.array(pantaPositionSchema).max(200),
          })
          .parse(read.value);
        if (holdings.wallet !== wallet) throw Error("Identity mismatch");
        result.positions = holdings.positions;
      } else {
        result.categories = z
          .object({ categories: z.array(z.string().max(100)).max(100) })
          .parse(read.value).categories;
      }
      available++;
    } catch {
      result.warnings.push(
        index === 0
          ? "Trade history unavailable or failed validation."
          : wallet
            ? "Wallet positions unavailable or failed validation."
            : "Provider categories unavailable.",
      );
    }
  }
  if (!available)
    throw new AppError(
      "PANTA_UNAVAILABLE",
      "Panta activity data is unavailable. Retry shortly.",
      502,
    );
  return result;
}
