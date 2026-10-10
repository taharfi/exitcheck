import { endpoint } from "@/lib/http";
import { pantaData } from "@/features/trade/panta-data";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const query = new URL(request.url).searchParams;
    return pantaData({ marketId: query.get("marketId") ?? undefined, wallet: query.get("wallet") ?? undefined });
  });
}
