import { z } from "zod";
import { endpoint, body } from "@/lib/http";
import { address, integer } from "@/lib/provider/schemas";
import { prepare } from "@/features/exits/service";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return endpoint(request, async (requestId) => {
    const input = z
      .object({
        owner: address,
        positionId: address,
        quantity: integer,
        kind: z.enum(["sell", "claim"]),
        minimumPrice: integer,
      })
      .parse(await body(request));
    return await prepare(
      input.owner,
      input.positionId,
      input.quantity,
      input.kind,
      input.minimumPrice,
      requestId,
    );
  });
}
