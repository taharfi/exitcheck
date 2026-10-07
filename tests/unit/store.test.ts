import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  insertAction,
  getAction,
  saveAction,
  lockSubmission,
  findActive,
  expirePrepared,
} from "../../src/features/exits/store";
import type { PreparedAction } from "../../src/features/exits/types";
process.env.ACTION_DB_PATH = `./test-results/unit-actions-${randomUUID()}.sqlite`;
const make = (): PreparedAction => ({
  id: randomUUID(),
  token: "a".repeat(64),
  owner: "fixture-owner",
  positionId: randomUUID(),
  kind: "sell",
  quantity: "1000000",
  createdAt: Date.now(),
  expiresAt: Date.now() + 20000,
  status: "prepared",
  transaction: "synthetic fixture only",
  blockhash: "fixture",
  lastValidBlockHeight: 1,
  orderId: null,
  signature: null,
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
  updatedAt: Date.now(),
});
it("prevents duplicate active preparation and verifies recovery capability", async () => {
  const a = make();
  await insertAction(a);
  expect((await getAction(a.id, a.token)).id).toBe(a.id);
  await expect(getAction(a.id, "b".repeat(64))).rejects.toThrow(
    "Invalid action recovery token",
  );
  await expect(insertAction({ ...a, id: randomUUID() })).rejects.toThrow(
    "already exists",
  );
  a.status = "rejected";
  await saveAction(a);
  await expect(
    insertAction({ ...a, id: randomUUID(), status: "prepared" }),
  ).resolves.toBeUndefined();
});
it("locks submission exactly once and persists uncertain signatures", async () => {
  const a = make();
  await insertAction(a);
  expect(await lockSubmission(a.id)).toBe(true);
  expect(await lockSubmission(a.id)).toBe(false);
  a.status = "unknown";
  a.signature = "fixture-signature";
  await saveAction(a);
  expect((await getAction(a.id, a.token)).signature).toBe("fixture-signature");
  expect((await findActive(a.owner, a.positionId))?.status).toBe("unknown");
  await expect(
    insertAction({ ...a, id: randomUUID(), status: "prepared" }),
  ).rejects.toThrow();
});
it("expires only unsigned prepared actions, never ambiguous submissions", async () => {
  const a = make();
  a.expiresAt = Date.now() - 1;
  await insertAction(a);
  expect(await expirePrepared(a)).toBe(true);
  expect(await findActive(a.owner, a.positionId)).toBeNull();
  const b = make();
  b.status = "unknown";
  b.expiresAt = Date.now() - 1;
  await insertAction(b);
  expect(await expirePrepared(b)).toBe(false);
});
it("prevents a slow reconciliation from downgrading a terminal result", async () => {
  const a = make();
  await insertAction(a);
  const stale = { ...a, status: "order-pending" as const };
  a.status = "filled";
  await saveAction(a);
  await saveAction(stale);
  expect((await getAction(a.id, a.token)).status).toBe("filled");
});
