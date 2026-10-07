import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  JupiterProvider,
  parseProviderJson,
} from "../../src/lib/provider/jupiter";
import {
  marketSchema,
  parseDepth,
  positionState,
  sellBuildSchema,
} from "../../src/lib/provider/schemas";
import { calculateExit } from "../../src/features/exits/calculations";
import { fixturePositions } from "../../src/lib/provider/fixture";
const snapshot = (name: string) =>
  readFileSync(`tests/fixtures/jupiter/live-${name}.json`, "utf8").replace(
    /^\uFEFF/,
    "",
  );
describe("real provider read response parsing", () => {
  it("parses the captured real flat market", () => {
    const m = marketSchema.parse(parseProviderJson(snapshot("markets")));
    expect(m.marketId).toBe("POLY-601826");
    expect(m.provider).toBe("polymarket");
    expect(m.status).toBe("open");
  });
  it("parses exact sub-cent prices and fractional quantities losslessly", () => {
    const d = parseDepth(parseProviderJson(snapshot("orderbook")));
    expect(d.yes.length).toBeGreaterThan(10);
    expect(
      d.yes.some((l) => BigInt(l.price) > 0n && BigInt(l.price) < 10000n),
    ).toBe(true);
    const e = calculateExit({
      quantity: "120000000",
      held: "120000000",
      isYes: true,
      depth: d,
      referencePrice: null,
    });
    expect(BigInt(e.gross)).toBeGreaterThan(0n);
    expect(e.net).toBeNull();
  });
  it("preserves quantities beyond JS safe integer and small decimals", () => {
    const parsed = parseProviderJson(
      '{"yes_dollars":[["0.000001",9007199254740993],["0.55",0.000001]],"no_dollars":[]}',
    );
    const d = parseDepth(parsed);
    expect(d.yes[0].quantity).toBe("9007199254740993000000");
    expect(d.yes[1].quantity).toBe("1");
  });
  it("rejects rounded-only books instead of guessing precise pricing", () =>
    expect(() => parseDepth({ yes: [[55, 2]], no: [] })).toThrow());
});
describe("provider failure and lifecycle fixtures (not live execution)", () => {
  it("blocks missing credentials", async () => {
    await expect(
      new JupiterProvider("").positions("11111111111111111111111111111111"),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
  });
  it.each([
    [401, "PROVIDER_AUTH"],
    [403, "ACCESS_RESTRICTED"],
    [429, "RATE_LIMIT"],
  ])("handles HTTP %s", async (status, code) => {
    const transport = (async () =>
      new Response("{}", { status: Number(status) })) as typeof fetch;
    await expect(
      new JupiterProvider("fixture-key", transport).tradingStatus(),
    ).rejects.toMatchObject({ code });
  });
  it("bounds read retries", async () => {
    let calls = 0;
    const transport = (async () => {
      calls++;
      return new Response("{}", { status: 503 });
    }) as typeof fetch;
    await expect(
      new JupiterProvider("fixture-key", transport).tradingStatus(),
    ).rejects.toThrow();
    expect(calls).toBe(2);
  });
  it("does not retry transaction construction", async () => {
    let calls = 0;
    const transport = (async () => {
      calls++;
      throw new Error("timeout");
    }) as typeof fetch;
    await expect(
      new JupiterProvider("fixture-key", transport).buildSell(
        fixturePositions[0],
        "1000000",
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
  it("normalizes resolved winners, losers, waiting, and unsupported states", () => {
    const m = {
      marketId: "test",
      provider: "polymarket",
      title: "Test",
      status: "closed",
      result: "yes" as const,
      closeTime: 1,
    };
    expect(positionState(fixturePositions[1], m)).toBe("claimable");
    expect(positionState({ ...fixturePositions[1], isYes: false }, m)).toBe(
      "no-payout",
    );
    expect(positionState(fixturePositions[1], { ...m, result: null })).toBe(
      "awaiting-resolution",
    );
    expect(
      positionState(fixturePositions[1], { ...m, provider: "bisonfi" }),
    ).toBe("unsupported");
  });
  it("validates documented fractional sell construction", async () => {
    let payload: Record<string, unknown> = {};
    const transport = (async (_url, init) => {
      payload = JSON.parse(String(init?.body));
      return new Response("{}");
    }) as typeof fetch;
    await expect(
      new JupiterProvider("fixture-key", transport).buildSell(
        fixturePositions[0],
        "5777773",
      ),
    ).rejects.toThrow();
    expect(payload.isBuy).toBe(false);
    expect(payload.contractsMicro).toBe("5777773");
    expect(payload.positionPubkey).toBe("fixture-open");
    expect(payload.contracts).toBeUndefined();
    expect(() => sellBuildSchema.parse({ transaction: "made-up" })).toThrow();
  });
});
