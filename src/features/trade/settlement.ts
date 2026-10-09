import { z } from "zod";
import { publicJson } from "./markets";
import { JupiterProvider } from "@/lib/provider/jupiter";
export async function verifiedSettlement(marketId: string) {
  const capturedAt = Date.now();
  if (/^jup:[a-zA-Z0-9_-]{1,140}$/.test(marketId)) {
    const m = await new JupiterProvider().market(marketId.slice(4));
    if (m.provider !== "polymarket")
      return {
        marketId,
        capturedAt,
        state: "unsupported",
        result: null,
        source: "Jupiter",
      };
    return {
      marketId,
      capturedAt,
      state:
        m.result !== null && ["closed", "resolved"].includes(m.status)
          ? "resolved"
          : "pending",
      result: m.result,
      source: "Jupiter confirmed Polymarket result",
    };
  }
  if (/^poly:\d{1,100}$/.test(marketId)) {
    const m = z
      .object({
        id: z.literal(marketId.slice(5)),
        conditionId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
      })
      .parse(
        await publicJson(
          `https://gamma-api.polymarket.com/markets/${marketId.slice(5)}`,
        ),
      );
    const book = z
      .object({
        condition_id: z.literal(m.conditionId),
        closed: z.boolean(),
        tokens: z
          .array(z.object({ outcome: z.string(), winner: z.boolean() }))
          .length(2),
      })
      .parse(
        await publicJson(
          `https://clob.polymarket.com/markets/${m.conditionId}`,
        ),
      );
    const winners = book.tokens.filter((t) => t.winner);
    const binary =
      book.tokens.every((t) =>
        ["yes", "no"].includes(t.outcome.toLowerCase()),
      ) && new Set(book.tokens.map((t) => t.outcome.toLowerCase())).size === 2;
    const result =
      book.closed && binary && winners.length === 1
        ? (winners[0].outcome.toLowerCase() as "yes" | "no")
        : null;
    return {
      marketId,
      capturedAt,
      state: result ? "resolved" : "pending",
      result,
      source: "Polymarket CLOB confirmed winning token",
    };
  }
  return {
    marketId,
    capturedAt,
    state: "unsupported",
    result: null,
    source: "No verified settlement adapter for this outcome",
  };
}
