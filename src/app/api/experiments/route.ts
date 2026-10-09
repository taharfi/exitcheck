import { randomUUID } from "node:crypto";
import { z } from "zod";
import { endpoint, body } from "@/lib/http";
import { account } from "@/features/account/auth";
import { AppError } from "@/lib/errors";
import { marketFeed } from "@/features/trade/markets";
import {
  advanceExperiment,
  createExperiment,
  planSchema,
} from "@/features/experiments/engine";
import type { Experiment } from "@/features/experiments/engine";
import { experimentDB, experiments } from "@/features/experiments/store";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const user = await account(request);
    return {
      signedIn: !!user,
      experiments: user ? await experiments(user.wallet) : [],
    };
  });
}
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const user = await account(request);
    if (!user)
      throw new AppError(
        "SIGN_IN_REQUIRED",
        "Sign in to save private paper experiments.",
        401,
      );
    const input = z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.literal("create"),
            plan: planSchema,
            approved: z.literal(true),
          })
          .strict(),
        z
          .object({
            action: z.enum(["check", "pause", "resume"]),
            id: z.string().uuid(),
          })
          .strict(),
      ])
      .parse(await body(request));
    const feed = input.action === "check" ? await marketFeed() : null;
    const db = experimentDB();
    return db.session(async () => {
      await db.exec("BEGIN IMMEDIATE");
      try {
        const list = await experiments(user.wallet);
        let exp: Experiment | undefined;
        if (input.action === "create") {
          if (list.length >= 20)
            throw new AppError("LIMIT", "Maximum 20 saved experiments.", 409);
          exp = createExperiment(randomUUID(), input.plan, Date.now());
        } else {
          exp = list.find((e) => e.id === input.id);
          if (!exp)
            throw new AppError("NOT_FOUND", "Experiment not found.", 404);
          if (input.action === "pause") exp.paused = true;
          else if (input.action === "resume") exp.paused = false;
          else if (feed) {
            const previous = exp.updatedAt;
            exp = advanceExperiment(exp, feed.markets, Date.now());
            const updated = exp;
            if (exp.updatedAt !== previous)
              await db
                .prepare(
                  "INSERT INTO experiment_observations(experiment,at,body) VALUES(?,?,?)",
                )
                .run(
                  exp.id,
                  exp.updatedAt,
                  JSON.stringify({
                    markets: feed.markets.filter((m) =>
                      updated.strategies.some((s) =>
                        s.positions.some((p) => p.marketId === m.id),
                      ),
                    ),
                    warnings: feed.warnings,
                    strategies: exp.strategies,
                  }),
                );
          }
        }
        await db
          .prepare(
            "INSERT INTO paper_experiments VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body WHERE wallet=excluded.wallet",
          )
          .run(exp.id, user.wallet, JSON.stringify(exp));
        await db.exec("COMMIT");
        return { experiment: exp };
      } catch (error) {
        await db.exec("ROLLBACK");
        throw error;
      }
    });
  });
}
