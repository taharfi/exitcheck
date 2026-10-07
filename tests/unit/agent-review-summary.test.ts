import { expect, it } from "vitest";
import { summarizeAgentReview } from "../../src/features/copy-trading/agent-review-summary";
import type { AgentEntryReview } from "../../src/features/copy-trading/agent-review";

const now = 1700000000000;
const report: AgentEntryReview = {
  decisionId: "proposal",
  checkedAt: now,
  expiresAt: now + 20000,
  sourceDelayMs: 5000,
  market: null,
  entry: {
    status: "within_limit",
    reason: "Price within limit.",
    quotePrice: "500000",
    differenceBps: "0",
    hypotheticalContracts: "20000000",
  },
  wallet: {
    status: "within_budget",
    reason: "Funds and held cost checked before fees.",
    selectedAsset: "USDC",
    funds: null,
    exposure: null,
    pendingAllocation: "10000000",
    remainingBudget: "70000000",
    remainingEventBudget: "10000000",
    providerFee: null,
    networkFee: null,
  },
  exit: {
    status: "covered",
    reason: "Snapshot covered.",
    estimate: null,
    coverageBps: "10000",
  },
  execution: "disabled",
};
it("prioritizes expired evidence over formerly passed or blocked checks", () => {
  const r = summarizeAgentReview({ ...report, expiresAt: now }, now);
  expect(r.title).toBe("Refresh this review");
  expect(r.status).toBe("incomplete");
});
it("shows both planning blockers without implying signing is available", () => {
  const r = summarizeAgentReview(
    {
      ...report,
      entry: { ...report.entry, status: "blocked", reason: "Price moved." },
      wallet: {
        ...report.wallet!,
        status: "blocked",
        reason: "Insufficient USDC.",
      },
    },
    now,
  );
  expect(r.status).toBe("blocked");
  expect(r.reason).toBe("Price moved. Insufficient USDC.");
});
it("keeps missing wallet evidence and partial or unknown exit coverage incomplete", () => {
  expect(
    summarizeAgentReview({ ...report, wallet: undefined }, now).status,
  ).toBe("incomplete");
  for (const status of ["limited", "unknown"] as const)
    expect(
      summarizeAgentReview({ ...report, exit: { ...report.exit, status } }, now)
        .status,
    ).toBe("incomplete");
});
it("does not turn successful planning checks into trade authorization", () => {
  const r = summarizeAgentReview(report, now);
  expect(r.status).toBe("checked");
  expect(r.reason).toContain("Wallet approval is unavailable");
  expect(r.reason).toContain("total costs");
});
