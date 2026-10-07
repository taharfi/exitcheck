import { z } from "zod";
const u = z.string().regex(/^\d{1,30}$/);
export const historySchema = z.object({
  id: u,
  eventType: z.string(),
  ownerPubkey: z.string(),
  positionPubkey: z.string(),
  marketId: z.string(),
  eventId: z.string(),
  timestamp: z.number().int().nonnegative(),
  isBuy: z.boolean(),
  isYes: z.boolean(),
  filledContractsMicro: u,
  contractsSettledMicro: u,
  avgFillPriceUsd: u,
  payoutAmountUsd: u,
  feeUsd: u.nullable(),
  eventMetadata: z.object({ title: z.string() }).nullable(),
  marketMetadata: z.object({ title: z.string() }).nullable(),
});
export type History = z.infer<typeof historySchema>;
export type Strategy = {
  name: string;
  entryBps: number;
  reserveBps: number;
  callerBps: number;
  eventBps: number;
  followSells: boolean;
};
export const strategies: Strategy[] = [
  {
    name: "Small entries",
    entryBps: 500,
    reserveBps: 3000,
    callerBps: 2333,
    eventBps: 1000,
    followSells: true,
  },
  {
    name: "Balanced entries",
    entryBps: 1000,
    reserveBps: 2000,
    callerBps: 2666,
    eventBps: 2000,
    followSells: true,
  },
  {
    name: "Hold to settlement",
    entryBps: 1000,
    reserveBps: 2000,
    callerBps: 2666,
    eventBps: 2000,
    followSells: false,
  },
];
const S = 1000000n,
  B = 10000n;
export function replay(
  history: History[],
  budget: string,
  strategy: Strategy,
  feeBps: number,
  slippageBps: number,
) {
  const initial = BigInt(budget);
  let cash = initial,
    realized = 0n,
    fees = 0n,
    peak = 0n,
    drawdown = 0n,
    copied = 0,
    skipped = 0,
    closed = 0;
  const positions = new Map<
      string,
      {
        owner: string;
        event: string;
        qty: bigint;
        cost: bigint;
        leader: bigint;
      }
    >(),
    receipts: {
      at: number;
      title: string;
      decision: string;
      reason: string;
    }[] = [];
  const sorted = [
    ...new Map(history.map((h) => [h.ownerPubkey + ":" + h.id, h])).values(),
  ].sort(
    (a, b) =>
      a.timestamp - b.timestamp || (BigInt(a.id) < BigInt(b.id) ? -1 : 1),
  );
  const record = (h: History, decision: string, reason: string) =>
    receipts.push({
      at: h.timestamp,
      title: h.eventMetadata?.title ?? h.marketMetadata?.title ?? h.marketId,
      decision,
      reason,
    });
  const settle = (
    p: { qty: bigint; cost: bigint },
    qty: bigint,
    proceeds: bigint,
  ) => {
    const basis = (p.cost * qty) / p.qty;
    cash += proceeds;
    realized += proceeds - basis;
    p.qty -= qty;
    p.cost -= basis;
    if (realized > peak) peak = realized;
    if (peak - realized > drawdown) drawdown = peak - realized;
    if (p.qty === 0n) closed++;
  };
  for (const h of sorted) {
    const key = h.ownerPubkey + ":" + h.positionPubkey;
    let p = positions.get(key);
    if (!p) {
      p = {
        owner: h.ownerPubkey,
        event: h.eventId,
        qty: 0n,
        cost: 0n,
        leader: 0n,
      };
      positions.set(key, p);
    }
    if (h.eventType === "order_filled" && h.isBuy) {
      const leaderQty = BigInt(h.filledContractsMicro);
      if (leaderQty === 0n) continue;
      p.leader += leaderQty;
      const price =
        (BigInt(h.avgFillPriceUsd) * (B + BigInt(slippageBps)) + B - 1n) / B;
      const skip = (reason: string) => {
        skipped++;
        record(h, "Skipped", reason);
      };
      if (price <= 0n || price >= S) {
        skip("Invalid fill price or slippage-adjusted entry >= $1.");
        continue;
      }
      let usedCaller = 0n,
        usedEvent = 0n;
      for (const x of positions.values()) {
        if (x.owner === h.ownerPubkey) usedCaller += x.cost;
        if (x.event === h.eventId) usedEvent += x.cost;
      }
      const caps = [
        (initial * BigInt(strategy.entryBps)) / B,
        (initial * BigInt(strategy.callerBps)) / B - usedCaller,
        (initial * BigInt(strategy.eventBps)) / B - usedEvent,
        cash - (initial * BigInt(strategy.reserveBps)) / B,
      ];
      const stake = caps.reduce((a, b) => (a < b ? a : b));
      const spend = (stake * B) / (B + BigInt(feeBps));
      if (stake < 5000000n) {
        skip("Budget, reserve, event/caller cap or $5 minimum reached.");
        continue;
      }
      const qty = (spend * S) / price;
      if (qty === 0n) {
        skip("Quantity rounded to zero.");
        continue;
      }
      const cost = (qty * price + S - 1n) / S,
        fee = (cost * BigInt(feeBps) + B - 1n) / B,
        total = cost + fee;
      if (total > stake) {
        skip("Rounding exceeded allocation.");
        continue;
      }
      cash -= total;
      fees += fee;
      p.qty += qty;
      p.cost += total;
      copied++;
      record(
        h,
        "Modeled buy",
        "Recorded leader fill + assumed slippage and fee; follower execution unverified.",
      );
    } else if (h.eventType === "order_filled" && !h.isBuy) {
      const leaderSold = BigInt(h.filledContractsMicro),
        before = p.leader;
      p.leader = before > leaderSold ? before - leaderSold : 0n;
      if (!strategy.followSells || p.qty === 0n) continue;
      if (before === 0n || leaderSold > before) {
        record(
          h,
          "Unmatched exit",
          "Leader inventory incomplete; no follower sale inferred.",
        );
        continue;
      }
      const qty = (p.qty * leaderSold) / before;
      if (qty === 0n) continue;
      const price = (BigInt(h.avgFillPriceUsd) * (B - BigInt(slippageBps))) / B;
      if (price <= 0n || price > S) {
        record(h, "Unmatched exit", "Invalid exit price.");
        continue;
      }
      const gross = (qty * price) / S,
        fee = (gross * BigInt(feeBps) + B - 1n) / B;
      fees += fee;
      settle(p, qty, gross - fee);
      record(h, "Modeled sell", "Proportional leader exit with assumed costs.");
    } else if (h.eventType === "payout_claimed" && p.qty > 0n) {
      const settled = BigInt(h.contractsSettledMicro),
        payout = BigInt(h.payoutAmountUsd);
      if (settled === 0n || payout !== settled) {
        record(
          h,
          "Unverified settlement",
          "Payout quantity is not a verified $1-per-contract winning settlement.",
        );
        continue;
      }
      const qty =
        p.leader > 0n && settled < p.leader
          ? (p.qty * settled) / p.leader
          : p.qty;
      if (qty > 0n) settle(p, qty, qty);
      p.leader = p.leader > settled ? p.leader - settled : 0n;
      record(
        h,
        "Modeled payout",
        "Observed historical winning payout; no future outcome used.",
      );
    } else if (h.eventType === "position_lost" && p.qty > 0n) {
      settle(p, p.qty, 0n);
      p.leader = 0n;
      record(h, "Modeled loss", "Observed historical losing settlement.");
    }
  }
  const open = [...positions.values()].filter((p) => p.qty > 0n),
    openCost = open.reduce((sum, p) => sum + p.cost, 0n);
  return {
    strategy: strategy.name,
    cash: String(cash),
    realizedPnl: String(realized),
    openCost: String(openCost),
    openPositions: open.length,
    modeledFees: String(fees),
    realizedDrawdown: String(drawdown),
    copied,
    skipped,
    closed,
    receipts: receipts.slice(-100).reverse(),
  };
}
