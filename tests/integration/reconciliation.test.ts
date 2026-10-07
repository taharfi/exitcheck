import { beforeEach, it, expect, vi } from "vitest";
import type { PreparedAction } from "../../src/features/exits/types";
import { AppError } from "../../src/lib/errors";
const mocks = vi.hoisted(() => ({
  chain: vi.fn(),
  order: vi.fn(),
  received: vi.fn(),
  save: vi.fn(),
}));
vi.mock("../../src/lib/provider/index", () => ({
  provider: () => ({ orderStatus: mocks.order }),
}));
vi.mock("../../src/features/exits/store", () => ({
  saveAction: mocks.save,
  expirePrepared: vi.fn(),
  findActive: vi.fn(),
  insertAction: vi.fn(),
}));
vi.mock("../../src/features/exits/transactions", () => ({
  rpc: () => ({ getSignatureStatuses: mocks.chain }),
  assertMainnet: vi.fn(),
  inspectTransaction: vi.fn(),
  receivedForSignatures: mocks.received,
}));
import { reconcile } from "../../src/features/exits/service";
const action = (): PreparedAction => ({
  id: "fixture-action",
  token: "a".repeat(64),
  owner: "fixture-owner",
  positionId: "fixture-position",
  kind: "sell",
  quantity: "1000000",
  createdAt: 1,
  expiresAt: 2,
  updatedAt: 1,
  status: "submitted",
  signature: "fixture-signature",
  transaction: "fixture",
  blockhash: "fixture",
  lastValidBlockHeight: 1,
  orderId: "fixture-order",
  actualReceived: null,
  providerStatus: null,
  expectedGross: null,
  estimatedFee: null,
  expectedNet: null,
  minSellPrice: null,
  networkFee: null,
  asset: "Fixture",
  programs: [],
  accounts: [],
  simulation: "Fixture",
  signingEnabled: false,
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.chain.mockResolvedValue({
    value: [{ err: null, confirmationStatus: "confirmed" }],
  });
  mocks.order.mockResolvedValue({
    orderPubkey: "fixture-order",
    status: "created",
    history: [],
  });
  mocks.received.mockResolvedValue(null);
});
it("keeps confirmation distinct from an unfilled order", async () => {
  expect((await reconcile(action())).status).toBe("order-pending");
  expect(mocks.save.mock.calls[0][0].signature).toBe("fixture-signature");
});
it("preserves verified chain confirmation when the provider rate limits tracking", async () => {
  mocks.order.mockRejectedValue(
    new AppError("RATE_LIMIT", "Wait before retrying.", 429),
  );
  const result = await reconcile(action());
  expect(result.status).toBe("confirmed");
  expect(result.actualReceived).toBeNull();
  expect(result.error).toContain("provider/result tracking is unavailable");
});
it("does not accept a provider fill as a verified received amount", async () => {
  mocks.order.mockResolvedValue({
    orderPubkey: "fixture-order",
    status: "filled",
    history: [{ eventType: "order_filled", signature: "fixture-fill" }],
  });
  expect((await reconcile(action())).status).toBe("unknown");
});
it("shows a partial fill separately and retains its observed verified credit", async () => {
  mocks.order.mockResolvedValue({
    orderPubkey: "fixture-order",
    status: "partiallyfilled",
    history: [{ eventType: "order_filled", signature: "fixture-fill" }],
  });
  mocks.received.mockResolvedValue({ amount: "12345", asset: "USDC" });
  const result = await reconcile(action());
  expect(result.status).toBe("partially-filled");
  expect(result.actualReceived).toBe("12345");
});
it("never creates a replacement on an ambiguous chain outcome", async () => {
  mocks.chain.mockResolvedValue({ value: [null] });
  const result = await reconcile(action());
  expect(result.status).toBe("unknown");
  expect(mocks.order).not.toHaveBeenCalled();
});
it("does not unlock an unverified fill when receipt RPC times out", async () => {
  mocks.order.mockResolvedValue({
    orderPubkey: "fixture-order",
    status: "filled",
    history: [{ eventType: "order_filled", signature: "fixture-fill" }],
  });
  mocks.received.mockRejectedValue(new Error("fixture RPC timeout"));
  const result = await reconcile(action());
  expect(result.status).toBe("unknown");
  expect(result.actualReceived).toBeNull();
});
