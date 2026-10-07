import { PublicKey, type Connection } from "@solana/web3.js";
import { z } from "zod";
import {
  assertMainnet,
  rpc,
  USDC,
  JUPUSD,
} from "@/features/exits/transactions";
import { address, integer } from "@/lib/provider/schemas";
import type { AgentDecision, AgentPlan } from "./agent-model";
import type { AgentRequest } from "./agent-source";

export type DepositAsset = "USDC" | "JupUSD";
export type WalletFunds = {
  at: number;
  balances: Record<DepositAsset, string | null>;
  solLamports: string | null;
};
export type WalletExposure = {
  at: number;
  heldCost: string;
  eventCost: string;
  oppositeContracts: string;
  positionCount: number;
  openOrders: number;
};
export type WalletReview = {
  status: "within_budget" | "blocked" | "unknown";
  reason: string;
  selectedAsset: DepositAsset;
  funds: WalletFunds | null;
  exposure: WalletExposure | null;
  pendingAllocation: string;
  remainingBudget: string | null;
  remainingEventBudget: string | null;
  providerFee: null;
  networkFee: null;
};
const tokenInfo = z.object({
  mint: address,
  owner: address,
  state: z.enum(["initialized", "frozen"]),
  delegate: address.optional(),
  tokenAmount: z.object({ amount: integer, decimals: z.literal(6) }),
});
export function tokenBalance(raw: unknown, owner: string, mint: string) {
  const accounts = z
    .array(
      z.object({
        pubkey: z.instanceof(PublicKey),
        account: z.object({
          owner: z.instanceof(PublicKey),
          data: z.object({
            parsed: z.object({ type: z.literal("account"), info: tokenInfo }),
          }),
        }),
      }),
    )
    .max(500)
    .parse(raw);
  const seen = new Set<string>();
  let amount = 0n;
  for (const item of accounts) {
    const id = item.pubkey.toBase58(),
      info = item.account.data.parsed.info;
    if (
      seen.has(id) ||
      info.owner !== owner ||
      info.mint !== mint ||
      ![
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      ].includes(item.account.owner.toBase58())
    )
      throw Error("Token-account identity could not be verified.");
    seen.add(id);
    // Delegated and frozen accounts are excluded conservatively, not presented as spendable.
    if (info.state === "initialized" && !info.delegate)
      amount += BigInt(info.tokenAmount.amount);
  }
  return amount.toString();
}
export async function readWalletFunds(
  owner: string,
  connection: Connection = rpc(),
): Promise<WalletFunds> {
  address.parse(owner);
  await assertMainnet(connection);
  const key = new PublicKey(owner);
  const readAt = async <T>(promise: Promise<T>) => ({
    data: await promise,
    at: Date.now(),
  });
  const result = await Promise.allSettled([
    readAt(
      connection.getParsedTokenAccountsByOwner(
        key,
        { mint: new PublicKey(USDC) },
        "confirmed",
      ),
    ),
    readAt(
      connection.getParsedTokenAccountsByOwner(
        key,
        { mint: new PublicKey(JUPUSD) },
        "confirmed",
      ),
    ),
    readAt(connection.getBalance(key, "confirmed")),
  ]);
  const read = (index: 0 | 1, mint: string) => {
    const value = result[index];
    if (value.status !== "fulfilled") return null;
    try {
      return tokenBalance(value.value.data.value, owner, mint);
    } catch {
      return null;
    }
  };
  const sol = result[2];
  return {
    at: Math.min(
      Date.now(),
      ...result.flatMap((item) =>
        item.status === "fulfilled" ? [item.value.at] : [],
      ),
    ),
    balances: { USDC: read(0, USDC), JupUSD: read(1, JUPUSD) },
    solLamports:
      sol.status === "fulfilled" &&
      Number.isSafeInteger(sol.value.data) &&
      sol.value.data >= 0
        ? String(sol.value.data)
        : null,
  };
}
const position = z.object({
  pubkey: address,
  ownerPubkey: address,
  marketId: z.string().min(1),
  eventId: z.string().min(1),
  isYes: z.boolean(),
  contractsMicro: integer,
  totalCostUsd: integer,
  claimed: z.boolean(),
  openOrders: z.number().int().nonnegative(),
});
export async function readWalletExposure(
  owner: string,
  decision: AgentDecision,
  request: AgentRequest,
): Promise<WalletExposure> {
  const seen = new Set<string>();
  let held = 0n,
    event = 0n,
    opposite = 0n,
    count = 0,
    orders = 0,
    start = 0;
  const began = Date.now();
  let capturedAt: number | null = null;
  for (let page = 0; page < 5; page++) {
    if (Date.now() - began > 15000)
      throw Error("Position reads exceeded the review window.");
    const data = z
      .object({
        data: z.array(position).max(100),
        pagination: z.object({
          hasNext: z.boolean(),
          end: z.number().int().nonnegative(),
          total: z.number().int().nonnegative(),
        }),
      })
      .parse(
        await request(
          "/positions?" +
            new URLSearchParams({
              ownerPubkey: owner,
              start: String(start),
              end: String(start + 100),
            }),
        ),
      );
    capturedAt ??= Date.now();
    if (Date.now() - began > 20000) throw Error("Position reads exceeded the review window.");
    for (const p of data.data) {
      if (p.ownerPubkey !== owner || seen.has(p.pubkey))
        throw Error("Position ownership or pagination could not be verified.");
      seen.add(p.pubkey);
      orders += p.openOrders;
      if (!p.claimed && BigInt(p.contractsMicro) > 0n) {
        held += BigInt(p.totalCostUsd);
        count++;
        if (p.eventId === decision.eventId) event += BigInt(p.totalCostUsd);
        if (
          p.marketId === decision.marketId &&
          p.isYes !== (decision.side === "yes")
        )
          opposite += BigInt(p.contractsMicro);
      }
    }
    if (!data.pagination.hasNext) {
      if (seen.size !== data.pagination.total)
        throw Error("Position coverage changed or is incomplete.");
      return {
        at: capturedAt,
        heldCost: String(held),
        eventCost: String(event),
        oppositeContracts: String(opposite),
        positionCount: count,
        openOrders: orders,
      };
    }
    if (!data.data.length || data.pagination.end <= start)
      throw Error("Position pagination stalled.");
    start = data.pagination.end;
  }
  throw Error("Position coverage exceeds the supported review limit.");
}
export function evaluateWalletReview(
  plan: Pick<AgentPlan, "budget">,
  decision: AgentDecision,
  selectedAsset: DepositAsset,
  funds: WalletFunds | null,
  exposure: WalletExposure | null,
  pending: { total: bigint; events: Map<string, bigint> },
  now = Date.now(),
): WalletReview {
  const fresh = (at: number) =>
    Number.isFinite(at) && at <= now && now - at <= 20000;
  if (funds && !fresh(funds.at)) funds = null;
  if (exposure && !fresh(exposure.at)) exposure = null;
  const total = exposure ? BigInt(exposure.heldCost) + pending.total : null;
  const event = exposure
    ? BigInt(exposure.eventCost) + (pending.events.get(decision.eventId) ?? 0n)
    : null;
  const max = (BigInt(plan.budget) * 80n) / 100n,
    eventMax = BigInt(plan.budget) / 5n;
  const remaining = (limit: bigint, allocated: bigint | null) =>
    allocated === null
      ? null
      : String(allocated < limit ? limit - allocated : 0n);
  const review: WalletReview = {
    status: "unknown",
    reason: "Wallet funds or complete position coverage could not be verified.",
    selectedAsset,
    funds,
    exposure,
    pendingAllocation: String(pending.total),
    remainingBudget: remaining(max, total),
    remainingEventBudget: remaining(eventMax, event),
    providerFee: null,
    networkFee: null,
  };
  const balance = funds?.balances[selectedAsset] ?? null;
  const blocked =
    balance !== null && BigInt(balance) < pending.total
      ? "The selected token balance cannot cover pending proposed entries before fees."
      : funds?.solLamports === "0"
        ? "This wallet has no SOL for network costs."
        : total !== null && total > max
          ? "Held position cost and pending entries exceed the 80% planning ceiling."
          : event !== null && event > eventMax
            ? "Held cost and pending entries for this event exceed the 20% planning ceiling."
            : exposure && BigInt(exposure.oppositeContracts) > 0n
              ? "You already hold the opposite outcome in this market. Review that position first."
              : exposure && exposure.openOrders > 0
                ? "Existing open orders make available exposure uncertain. Reconcile them first."
                : null;
  if (blocked) {
    review.status = "blocked";
    review.reason = blocked;
  } else if (
    balance !== null &&
    funds?.solLamports !== null &&
    funds &&
    exposure
  ) {
    review.status = "within_budget";
    review.reason =
      "Observed funds and held cost are within planning limits before fees. Pending entries are conservatively charged to the selected token. Fees, rent and buy execution remain unverified; no funds are reserved.";
  }
  return review;
}
