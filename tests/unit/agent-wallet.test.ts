import { expect, it } from "vitest";
import { PublicKey, type Connection } from "@solana/web3.js";
import {
  tokenBalance,
  readWalletFunds,
  readWalletExposure,
  evaluateWalletReview,
  type WalletFunds,
  type WalletExposure,
} from "../../src/features/copy-trading/agent-wallet";
import { USDC, JUPUSD } from "../../src/features/exits/transactions";
import type {
  AgentPlan,
  AgentDecision,
} from "../../src/features/copy-trading/agent-model";
const owner = "11111111111111111111111111111111",
  other = "DVHD66wYT5wFcgJ9K2SbtJTmbsJxzz6chkAzNwzbksdT";
const now = Date.now();
const plan = { budget: "100000000" } as AgentPlan;
const decision = {
  eventId: "event",
  marketId: "market",
  side: "yes",
} as AgentDecision;
const funds: WalletFunds = {
  at: now,
  balances: { USDC: "100000000", JupUSD: "0" },
  solLamports: "1000000",
};
const exposure: WalletExposure = {
  at: now,
  heldCost: "10000000",
  eventCost: "5000000",
  oppositeContracts: "0",
  positionCount: 1,
  openOrders: 0,
};
const pending = { total: 10000000n, events: new Map([["event", 10000000n]]) };
function account(amount = "10000000", overrides: Record<string, unknown> = {}) {
  return {
    pubkey: new PublicKey(other),
    account: {
      owner: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      data: {
        parsed: {
          type: "account",
          info: {
            owner,
            mint: USDC,
            state: "initialized",
            tokenAmount: { amount, decimals: 6 },
            ...overrides,
          },
        },
      },
    },
  };
}
it("keeps exact balances and excludes frozen/delegated accounts", () => {
  expect(tokenBalance([account("9007199254740993123")], owner, USDC)).toBe(
    "9007199254740993123",
  );
  expect(tokenBalance([account("10", { state: "frozen" })], owner, USDC)).toBe(
    "0",
  );
  expect(tokenBalance([account("10", { delegate: other })], owner, USDC)).toBe(
    "0",
  );
});
it("rejects token ownership, mint, decimals, program and duplicate inconsistencies", () => {
  for (const info of [
    { owner: other },
    { mint: JUPUSD },
    { tokenAmount: { amount: "1", decimals: 9 } },
  ])
    expect(() => tokenBalance([account("10", info)], owner, USDC)).toThrow();
  expect(() => tokenBalance([account(), account()], owner, USDC)).toThrow();
  const wrong = account();
  wrong.account.owner = new PublicKey(owner);
  expect(() => tokenBalance([wrong], owner, USDC)).toThrow();
});
it("checks mainnet and preserves missing token balances rather than replacing them with zero", async () => {
  const connection = {
    getGenesisHash: async () => "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    getBalance: async () => Number.MAX_SAFE_INTEGER + 1,
    getParsedTokenAccountsByOwner: async (
      _owner: PublicKey,
      filter: { mint: PublicKey },
    ) => {
      if (filter.mint.toBase58() === JUPUSD) throw Error("Synthetic outage");
      return { value: [account()] };
    },
  } as unknown as Connection;
  const result = await readWalletFunds(owner, connection);
  expect(result.balances).toEqual({ USDC: "10000000", JupUSD: null });
  expect(result.solLamports).toBeNull();
  await expect(
    readWalletFunds(owner, {
      ...connection,
      getGenesisHash: async () => "devnet",
    } as Connection),
  ).rejects.toThrow();
});
it("includes held cost and pending proposals exactly once, while keeping token budgets separate", () => {
  const r = evaluateWalletReview(
    plan,
    decision,
    "USDC",
    funds,
    exposure,
    pending,
    now,
  );
  expect(r.status).toBe("within_budget");
  expect(r.remainingBudget).toBe("60000000");
  expect(r.remainingEventBudget).toBe("5000000");
  expect(r.providerFee).toBeNull();
  expect(r.networkFee).toBeNull();
  expect(
    evaluateWalletReview(
      plan,
      decision,
      "JupUSD",
      funds,
      exposure,
      pending,
      now,
    ).status,
  ).toBe("blocked");
});
it("blocks inadequate tokens, zero SOL, held/event ceilings, opposing positions and open orders", () => {
  for (const [f, e] of [
    [{ ...funds, balances: { USDC: "1", JupUSD: "999999999" } }, exposure],
    [{ ...funds, solLamports: "0" }, exposure],
    [funds, { ...exposure, heldCost: "80000000" }],
    [funds, { ...exposure, eventCost: "20000000" }],
    [funds, { ...exposure, oppositeContracts: "1" }],
    [funds, { ...exposure, openOrders: 1 }],
  ] as [WalletFunds, WalletExposure][])
    expect(
      evaluateWalletReview(plan, decision, "USDC", f, e, pending, now).status,
    ).toBe("blocked");
});
it("keeps unavailable, stale and future funds/exposure unknown", () => {
  for (const f of [
    null,
    { ...funds, at: now - 20001 },
    { ...funds, at: now + 1 },
    { ...funds, solLamports: null },
  ])
    expect(
      evaluateWalletReview(plan, decision, "USDC", f, exposure, pending, now)
        .status,
    ).toBe("unknown");
  for (const e of [null, { ...exposure, at: now - 20001 }])
    expect(
      evaluateWalletReview(plan, decision, "USDC", funds, e, pending, now)
        .remainingBudget,
    ).toBeNull();
});
const position = {
  pubkey: other,
  ownerPubkey: owner,
  marketId: "market",
  eventId: "event",
  isYes: false,
  contractsMicro: "5000000",
  totalCostUsd: "2000000",
  claimed: false,
  openOrders: 0,
};
it("reads complete provider positions and identifies the opposite outcome", async () => {
  const r = await readWalletExposure(owner, decision, async (path) => {
    expect(path).toContain("ownerPubkey=" + owner);
    return {
      data: [position],
      pagination: { end: 1, total: 1, hasNext: false },
    };
  });
  expect(r.heldCost).toBe("2000000");
  expect(r.eventCost).toBe("2000000");
  expect(r.oppositeContracts).toBe("5000000");
});
it("rejects wrong owners, missing cost/event identity, incomplete totals and stalled pages", async () => {
  for (const data of [
    {
      data: [{ ...position, ownerPubkey: other }],
      pagination: { end: 1, total: 1, hasNext: false },
    },
    {
      data: [{ ...position, totalCostUsd: undefined }],
      pagination: { end: 1, total: 1, hasNext: false },
    },
    {
      data: [{ ...position, eventId: undefined }],
      pagination: { end: 1, total: 1, hasNext: false },
    },
    { data: [], pagination: { end: 0, total: 10, hasNext: false } },
    { data: [], pagination: { end: 0, total: 10, hasNext: true } },
  ])
    await expect(
      readWalletExposure(owner, decision, async () => data),
    ).rejects.toThrow();
});
it("rejects duplicate positions across pages instead of double-counting exposure", async () => {
  let calls = 0;
  await expect(
    readWalletExposure(owner, decision, async () => ({
      data: [position],
      pagination: { end: ++calls, total: 2, hasNext: calls === 1 },
    })),
  ).rejects.toThrow();
});
