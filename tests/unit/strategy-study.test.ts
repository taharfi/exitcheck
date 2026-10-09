import { expect, it } from "vitest";
import { replay, mockExecutionCase } from "@/features/strategy-study/study";
import type { MarketPoint } from "@/features/prediction-bot/market-recorder";
const now = 1800000000000;
function point(i: number, bid: number, depth = true): MarketPoint {
  const at = now + i * 60000;
  return {
    at,
    routeAt: at,
    externalAt: at,
    verified: true,
    independent: false,
    reason: "Same underlying",
    external: null,
    route: {
      source: "jupiter",
      id: "POLY-1-0",
      title: "Test",
      rules: "Rules",
      closesAt: now + 86400000,
      bid: String(Math.round(bid * 1e6)),
      ask: String(Math.round((bid + 0.01) * 1e6)),
      tokenIds: ["1", "2"],
      outcomes: ["Yes", "No"],
      outcome: "Yes",
      status: "open",
    },
    ...(depth
      ? {
          exitDepth: {
            yes: [
              { price: String(Math.round(bid * 1e6)), quantity: "1000000000" },
            ],
            no: [],
            capturedAt: at,
          },
        }
      : {}),
  };
}
it("keeps cash baseline and chronological evaluation isolated", () => {
  const result = replay(
    [
      point(0, 0.4),
      point(1, 0.44),
      point(2, 0.5),
      point(3, 0.45),
      point(4, 0.4),
      point(5, 0.44),
      point(6, 0.5),
      point(7, 0.6),
      point(8, 0.64),
      point(9, 0.7),
    ],
    300,
  );
  expect(result.development[0].cash).toBe(300);
  expect(result.evaluation[0].cash).toBe(300);
  expect(result.evaluation[1].signals).toBe(1);
  expect(result.evaluation[1].log[0].at).toBe(now + 8 * 60000);
  expect(result.qualified).toBe(false);
  expect(result.development[1].closed).toBeGreaterThan(0);
});
it("liquidity strategy blocks missing depth and exits never assume a fill", () => {
  const points = Array.from({ length: 10 }, (_, i) =>
    point(i, 0.3 + i * 0.04, false),
  );
  const result = replay(points, 300);
  expect(result.development[3].open).toBe(0);
  expect(result.development[3].blocked).toBeGreaterThan(0);
  expect(result.development[1].closed).toBe(0);
  expect(
    result.development[1].log.some((l) => l.decision.startsWith("Hold:")),
  ).toBe(true);
});
it("blocks gaps, stale quotes and changed contract rules", () => {
  const points = Array.from({ length: 10 }, (_, i) => ({
    ...point(i, 0.3 + i * 0.04),
    routeAt: now - 60000,
  }));
  expect(replay(points, 300).development[1].signals).toBe(0);
  const a = point(0, 0.3),
    b = point(1, 0.4);
  b.route.rules = "Changed";
  expect(
    replay([a, b, point(2, 0.4), point(3, 0.4)], 300).development[1].signals,
  ).toBe(0);
});
it("mock execution refuses unapproved, stale, illiquid and duplicate requests", () => {
  const result = mockExecutionCase();
  expect(result.mode).toBe("mock");
  expect(result.steps).toEqual([
    "blocked",
    "blocked",
    "blocked",
    "mock filled",
    "duplicate ignored",
  ]);
  expect(result.fills).toBe(1);
});
