import { z } from "zod";
import { endpoint } from "@/lib/http";
import { pantaMarket } from "@/features/trade/panta";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const id = z
      .string()
      .regex(/^panta:[1-9A-HJ-NP-Za-km-z]{32,44}$/)
      .parse(new URL(request.url).searchParams.get("id"));
    return pantaMarket(id);
  });
}
