import { endpoint } from "@/lib/http";
import { address } from "@/lib/provider/schemas";
import { discover } from "@/features/exits/service";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return endpoint(
    request,
    async () =>
      await discover(
        address.parse(new URL(request.url).searchParams.get("owner")),
      ),
  );
}
