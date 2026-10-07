import { endpoint } from "@/lib/http";
import { marketFeed } from "@/features/trade/markets";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  return endpoint(request, marketFeed);
}
export { POST } from "./research/route";
