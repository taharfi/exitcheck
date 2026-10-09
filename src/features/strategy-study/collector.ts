import {
  collectMarkets,
  marketRecorder,
} from "@/features/prediction-bot/market-recorder";
import { JupiterProvider } from "@/lib/provider/jupiter";
export async function collectStudy() {
  let depths = 0;
  const result = await collectMarkets(
    marketRecorder(),
    undefined,
    undefined,
    undefined,
    async (point) => {
      try {
        point.exitDepth = await new JupiterProvider().depth(point.route.id);
        depths++;
      } catch {
        point.depthError =
          "Solana exit depth unavailable; never substituted with underlying venue depth.";
      }
      point.at = Date.now();
      return point;
    },
  );
  return { ...result, depths };
}
