import { z } from "zod";
import { endpoint } from "@/lib/http";
import { marketFeed } from "@/features/trade/markets";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const raw = new URL(request.url).searchParams.get("limit");
    const limit =
      raw === null ? 1120 : z.coerce.number().int().min(1).max(1120).parse(raw);
    const feed = await marketFeed();
    return { ...feed, markets: feed.markets.slice(0, limit) };
  });
}
export { POST } from "./research/route";
