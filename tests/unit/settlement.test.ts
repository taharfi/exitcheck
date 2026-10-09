import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ json: vi.fn(), market: vi.fn() }));
vi.mock("@/features/trade/markets", () => ({ publicJson: mocks.json }));
vi.mock("@/lib/provider/jupiter", () => ({
  JupiterProvider: class {
    market = mocks.market;
  },
}));
import { verifiedSettlement } from "@/features/trade/settlement";
afterEach(() => {
  mocks.json.mockReset();
  mocks.market.mockReset();
});
it("does not infer final results from an open market or a merely expired clock", async () => {
  mocks.market.mockResolvedValue({
    provider: "polymarket",
    status: "open",
    result: "yes",
  });
  expect((await verifiedSettlement("jup:POLY-1")).state).toBe("pending");
});
it("requires one confirmed binary winning token and exact provider identity", async () => {
  const condition = "0x" + "a".repeat(64);
  mocks.json
    .mockResolvedValueOnce({ id: "1", conditionId: condition })
    .mockResolvedValueOnce({
      condition_id: condition,
      closed: true,
      tokens: [
        { outcome: "Yes", winner: true },
        { outcome: "No", winner: false },
      ],
    });
  expect((await verifiedSettlement("poly:1")).result).toBe("yes");
});
it("keeps cancelled or ambiguous results unsettled", async () => {
  const condition = "0x" + "a".repeat(64);
  mocks.json
    .mockResolvedValueOnce({ id: "1", conditionId: condition })
    .mockResolvedValueOnce({
      condition_id: condition,
      closed: true,
      tokens: [
        { outcome: "Yes", winner: true },
        { outcome: "No", winner: true },
      ],
    });
  expect((await verifiedSettlement("poly:1")).state).toBe("pending");
  expect((await verifiedSettlement("sol:BTC-UP")).state).toBe("unsupported");
});
