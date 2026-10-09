import { z } from "zod";
import { endpoint, body } from "@/lib/http";
import { account } from "@/features/account/auth";
import { AppError } from "@/lib/errors";
import { marketRecorder } from "@/features/prediction-bot/market-recorder";
import { collectStudy } from "@/features/strategy-study/collector";
import { replay, mockExecutionCase } from "@/features/strategy-study/study";
export const runtime = "nodejs";
export const maxDuration = 90;
async function output(budget: number) {
  const store = marketRecorder();
  return {
    study: replay(await store.points(), budget),
    feeds: (await store.feeds()).map((f) => ({
      source: f.source,
      at: f.at,
      error: f.error,
      markets: f.markets.length,
    })),
    mock: mockExecutionCase(),
  };
}
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const url = new URL(request.url);
    const budget = z.coerce
      .number()
      .min(30)
      .max(10000)
      .parse(url.searchParams.get("budget") ?? 300);
    return output(budget);
  });
}
export async function POST(request: Request) {
  return endpoint(request, async () => {
    if (!(await account(request)))
      throw new AppError(
        "SIGN_IN_REQUIRED",
        "Sign in to request a shared public-market observation.",
        401,
      );
    const input = z
      .object({ budget: z.number().min(30).max(10000) })
      .strict()
      .parse(await body(request));
    const store = marketRecorder();
    const points = await store.points();
    if (points.length && Date.now() - points.at(-1)!.at < 60000)
      throw new AppError(
        "WAIT",
        "Wait one minute between collection requests.",
        429,
      );
    return {
      collection: await collectStudy(),
      ...(await output(input.budget)),
    };
  });
}
