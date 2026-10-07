import { endpoint } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { address } from "@/lib/provider/schemas";
import { JupiterProvider } from "@/lib/provider/jupiter";
import {
  readAgentActivity,
  type AgentActivitySample,
} from "@/features/copy-trading/agent-source";
export const runtime = "nodejs";
const cache = new Map<string, AgentActivitySample>();
const pending = new Map<string, Promise<AgentActivitySample>>();
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const parameters = new URL(request.url).searchParams;
    const parsed = address.safeParse(parameters.get("trader"));
    if (
      !parsed.success ||
      [...parameters.keys()].some((key) => key !== "trader") ||
      parameters.getAll("trader").length !== 1
    )
      throw new AppError(
        "INVALID_TRADER",
        "Choose a valid Solana public trader address.",
        422,
      );
    const trader = parsed.data;
    const hit = cache.get(trader);
    if (hit && Date.now() - hit.retrievedAt < 30000) return hit;
    const running = pending.get(trader);
    if (running) return running;
    if (pending.size >= 20)
      throw new AppError(
        "ACTIVITY_BUSY",
        "Activity checks are busy. Please try again shortly.",
        503,
      );
    const work = readAgentActivity(trader, (path) =>
      new JupiterProvider().request(path),
    );
    pending.set(trader, work);
    try {
      const sample = await work;
      if (cache.size >= 50) cache.clear();
      cache.set(trader, sample);
      return sample;
    } finally {
      pending.delete(trader);
    }
  });
}
