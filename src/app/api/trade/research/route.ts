import { z } from "zod";
import { endpoint, body } from "@/lib/http";
import { knownMarket } from "@/features/trade/markets";
import { boundedResearch } from "@/features/trade/research";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const input = z
      .object({
        marketId: z.string().max(150),
        question: z.string().max(1000),
        marketPrice: z.number().finite().min(0).max(1),
        rules: z.string().max(15000),
      })
      .strict()
      .parse(await body(request));
    // Canonical provider fields replace client text and price before any paid request.
    const m = await knownMarket(input.marketId);
    return boundedResearch(
      m,
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local",
    );
  });
}
