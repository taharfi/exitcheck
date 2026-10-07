import { randomBytes } from "node:crypto";
import { z } from "zod";
import { endpoint, body } from "@/lib/http";
import { address } from "@/lib/provider/schemas";
import { startPaper } from "@/features/copy-trading/paper";
import {
  shadowStore,
  sessionHash,
  publicShadow,
} from "@/features/copy-trading/shadow-store";
import { AppError } from "@/lib/errors";
import {
  portfolioKey,
  readCookie,
  sessionCookie,
} from "@/features/account/auth";
export const runtime = "nodejs";
const cookie = "exitcheck-shadow";
function token(request: Request) {
  return readCookie(request, cookie);
}
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const key = await portfolioKey(request);
    const row = key ? await shadowStore().get(key) : null;
    return {
      portfolio: publicShadow(row),
      observations: row
        ? (
            await Promise.all(
              row.paper.owners.map(async (owner) =>
                (await shadowStore().observations(owner)).filter(
                  (o) => o.observedAt >= row.createdAt,
                ),
              ),
            )
          )
            .flat()
            .sort((a, b) => b.observedAt - a.observedAt)
            .slice(0, 50)
        : [],
      collectorEnabled: process.env.SHADOW_COLLECTOR_ENABLED === "true",
      coverage:
        "Sampled recent trades, not a complete wallet stream. Indicative quotes exclude fees and executable depth.",
    };
  });
}
export async function POST(request: Request) {
  let issued: string | null = null;
  const response = await endpoint(request, async () => {
    const input = z
      .discriminatedUnion("action", [
        z.object({
          action: z.literal("start"),
          owners: z
            .array(address)
            .min(1)
            .max(3)
            .refine((xs) => new Set(xs).size === xs.length),
          budget: z.string().regex(/^\d{1,13}$/),
        }),
        z.object({ action: z.enum(["pause", "resume", "stop"]) }),
      ])
      .parse(await body(request));
    const store = shadowStore(),
      currentToken = token(request);
    const ownerKey = await portfolioKey(request);
    if (input.action === "start") {
      if (process.env.SHADOW_COLLECTOR_ENABLED !== "true")
        throw new AppError(
          "COLLECTOR_DISABLED",
          "Background collection is disabled on this server.",
          503,
        );
      const t = currentToken ?? randomBytes(32).toString("hex");
      let paper;
      try {
        paper = startPaper(input.budget, input.owners);
      } catch {
        throw new AppError(
          "INVALID_BUDGET",
          "Use a virtual budget of $100 to $1,000,000.",
          422,
        );
      }
      const row = await store.create(ownerKey ?? sessionHash(t), paper);
      if (!ownerKey) issued = t;
      return { portfolio: publicShadow(row) };
    }
    if (!ownerKey)
      throw new AppError(
        "SHADOW_NOT_FOUND",
        "No background portfolio is saved in this browser.",
        404,
      );
    const key = ownerKey,
      row = await store.get(key);
    if (!row)
      throw new AppError(
        "SHADOW_NOT_FOUND",
        "Background portfolio not found.",
        404,
      );
    if (input.action === "stop") {
      await store.remove(key);
      return { portfolio: null };
    }
    if (row.expiresAt <= Date.now())
      throw new AppError(
        "SHADOW_EXPIRED",
        "This seven-day session has ended. Stop it to start a new session.",
        409,
      );
    const wasPaused = row.paper.paused;
    row.paper.paused = input.action === "pause";
    if (input.action === "resume" && wasPaused) {
      if (
        (await store.active()).filter((active) => active.id !== row.id)
          .length >= 25
      )
        throw new AppError(
          "SHADOW_CAPACITY",
          "This server is at monitoring capacity.",
          429,
        );
      row.acceptAfter = Date.now();
      row.gaps++;
    }
    if (!(await store.save(row)))
      throw new AppError(
        "SHADOW_CHANGED",
        "Portfolio changed while updating. Refresh and try again.",
        409,
      );
    return { portfolio: publicShadow(await store.get(key)) };
  });
  if (issued && response.ok)
    response.headers.set(
      "Set-Cookie",
      sessionCookie(request, cookie, issued, 1209600),
    );
  return response;
}
