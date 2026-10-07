import { endpoint, body } from "@/lib/http";
import { account } from "@/features/account/auth";
import { AppError } from "@/lib/errors";
import { z } from "zod";
import { marketRecorder } from "@/features/prediction-bot/market-recorder";
import { compareStrategies } from "@/features/prediction-bot/strategy-lab";
export const runtime = "nodejs";
const settings = z.object({
  budget: z
    .string()
    .regex(/^\d{1,7}(\.\d{1,2})?$/)
    .refine((v) => Number(v) >= 100 && Number(v) <= 1000000),
  strategy: z.enum(["Momentum", "Price divergence", "No trade"]),
  watching: z.boolean(),
});
async function setup() {
  const store = marketRecorder();
  await store.db.exec(
    "CREATE TABLE IF NOT EXISTS research_bots(wallet TEXT PRIMARY KEY,body TEXT NOT NULL)",
  );
  return store;
}
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const user = await account(request);
    if (!user)
      throw new AppError(
        "SIGN_IN_REQUIRED",
        "Sign in with your wallet to save a paper plan.",
        401,
      );
    const plan = settings.parse(await body(request));
    const store = await setup();
    await store.db
      .prepare(
        "INSERT INTO research_bots VALUES(?,?) ON CONFLICT(wallet) DO UPDATE SET body=excluded.body",
      )
      .run(user.wallet, JSON.stringify(plan));
    return { saved: true };
  });
}
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const store = await setup(),
      points = await store.points(),
      user = await account(request);
    const row = user
      ? ((await store.db
          .prepare("SELECT body FROM research_bots WHERE wallet=?")
          .get(user.wallet)) as { body: string } | undefined)
      : undefined;
    const latest = new Map(points.map((p) => [p.route.id, p]));
    return {
      bot: row ? JSON.parse(row.body) : null,
      signedIn: !!user,
      feeds: (await store.feeds()).map(({ source, at, error, markets }) => ({
        source,
        at,
        error,
        count: markets.length,
      })),
      markets: [...latest.values()],
      observations: points.length,
      firstAt: points[0]?.at ?? null,
      lastAt: points.at(-1)?.at ?? null,
      strategies: compareStrategies(points),
      collectorEnabled: process.env.MARKET_RECORDER_ENABLED === "true",
      execution: "disabled",
      qualification:
        "Collecting data. No strategy has qualified on unseen data.",
      coverage:
        "Up to four future crypto markets from a bounded Jupiter sample, polled every minute while this server is online. Direct Kalshi catalog is an unmatched public sample. Missing feeds and gaps block decisions.",
    };
  });
}
