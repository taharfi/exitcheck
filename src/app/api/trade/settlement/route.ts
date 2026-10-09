import { z } from "zod";
import { endpoint, body } from "@/lib/http";
import { verifiedSettlement } from "@/features/trade/settlement";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const { marketId } = z
      .object({
        marketId: z
          .string()
          .regex(
            /^(poly:\d{1,100}|jup:[a-zA-Z0-9_-]{1,140}|sol:[a-zA-Z0-9_-]{1,140})$/,
          ),
      })
      .strict()
      .parse(await body(request));
    return verifiedSettlement(marketId);
  });
}
