import { z } from "zod";
import { endpoint, body } from "@/lib/http";
import { address, integer } from "@/lib/provider/schemas";
import { preview } from "@/features/exits/service";
import { provider } from "@/lib/provider/index";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const input = z
      .object({
        owner: address,
        positionId: z.string().min(1).max(100),
        quantity: integer,
      })
      .parse(await body(request));
    if (provider().mode === "production") address.parse(input.positionId);
    return await preview(input.owner, input.positionId, input.quantity);
  });
}
