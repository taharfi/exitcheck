import { z } from "zod";
const uint = z.string().regex(/^\d{1,30}$/);
export const traderSchema = z.object({
  ownerPubkey: z.string(),
  realizedPnlUsd: z.string().regex(/^-?\d+$/),
  totalVolumeUsd: uint,
  predictionsCount: uint,
  correctPredictions: uint,
  wrongPredictions: uint,
  winRatePct: z.string(),
});
export const tradeSchema = z.object({
  id: z.string(),
  ownerPubkey: z.string(),
  marketId: z.string(),
  eventId: z.string(),
  eventTitle: z.string(),
  marketTitle: z.string(),
  timestamp: z
    .union([uint, z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)])
    .transform(String),
  action: z.enum(["buy", "sell"]),
  side: z.enum(["yes", "no"]),
  amountUsd: uint,
  priceUsd: uint,
});
export type Trader = z.infer<typeof traderSchema>;
export type Trade = z.infer<typeof tradeSchema>;
export type Quote = {
  marketId: string;
  status: string;
  result: "yes" | "no" | null;
  provider: string;
  closeTime: number;
  yes: string | null;
  no: string | null;
  retrievedAt: number;
};
export const paperSchema = z.object({
  version: z.literal(1),
  budget: uint,
  cash: uint,
  startedAt: z.number(),
  paused: z.boolean(),
  owners: z.array(z.string()).min(1).max(3),
  seen: z.array(z.string()),
  positions: z.array(
    z.object({
      id: z.string(),
      owner: z.string(),
      marketId: z.string(),
      eventId: z.string(),
      title: z.string(),
      side: z.enum(["yes", "no"]),
      cost: uint,
      contracts: uint,
      entry: uint,
      settled: z.boolean(),
      payout: uint.nullable(),
    }),
  ),
  journal: z.array(
    z.object({
      id: z.string(),
      at: z.number(),
      title: z.string(),
      decision: z.string(),
      reason: z.string(),
    }),
  ),
});
export type Paper = z.infer<typeof paperSchema>;
const scale = 1000000n;
export function startPaper(
  budget: string,
  owners: string[],
  now = Date.now(),
): Paper {
  if (
    BigInt(budget) < 100000000n ||
    BigInt(budget) > 1000000000000n ||
    owners.length < 1 ||
    owners.length > 3 ||
    new Set(owners).size !== owners.length
  )
    throw Error("Use $100 to $1,000,000 and one to three different wallets.");
  return paperSchema.parse({
    version: 1,
    budget,
    cash: budget,
    owners,
    startedAt: now,
    paused: false,
    seen: [],
    positions: [],
    journal: [],
  });
}
export function evaluatePaper(
  original: Paper,
  trades: Trade[],
  quotes: Quote[],
  now = Date.now(),
): Paper {
  const p = structuredClone(original),
    budget = BigInt(p.budget),
    reserve = (budget * 30n) / 100n,
    callerCap = (budget - reserve) / BigInt(p.owners.length);
  const note = (id: string, title: string, decision: string, reason: string) =>
    p.journal.unshift({ id, at: now, title, decision, reason });
  for (const pos of p.positions) {
    const q = quotes.find((q) => q.marketId === pos.marketId);
    if (!pos.settled && q?.result && now - q.retrievedAt <= 20000) {
      const payout = pos.side === q.result ? BigInt(pos.contracts) : 0n;
      pos.settled = true;
      pos.payout = String(payout);
      p.cash = String(BigInt(p.cash) + payout);
      note(
        "settle:" + pos.id,
        pos.title,
        "Settled",
        payout
          ? "Winning hypothetical payout; fees excluded."
          : "Losing hypothetical position.",
      );
    }
  }
  if (p.paused) return p;
  const realized = p.positions
    .filter((x) => x.settled)
    .reduce((sum, x) => sum + BigInt(x.payout ?? "0") - BigInt(x.cost), 0n);
  if (realized <= -(budget / 10n)) {
    p.paused = true;
    note(
      "pause:" + now,
      "Portfolio",
      "Paused",
      "Realized loss reached 10% of starting budget. Open positions can still lose.",
    );
    return p;
  }
  for (const t of [...trades].sort(
    (a, b) => Number(a.timestamp) - Number(b.timestamp),
  )) {
    if (
      !p.owners.includes(t.ownerPubkey) ||
      p.seen.includes(t.id) ||
      Number(t.timestamp) * 1000 < p.startedAt
    )
      continue;
    p.seen.push(t.id);
    const skip = (why: string) =>
      note(t.id, t.eventTitle + " ? " + t.marketTitle, "Skipped", why);
    if (t.action === "sell") {
      skip(
        "Exit signal recorded; copying exits is not supported in this version.",
      );
      continue;
    }
    if (
      now - Number(t.timestamp) * 1000 > 120000 ||
      Number(t.timestamp) * 1000 > now + 5000
    ) {
      skip(
        "Signal is older than two minutes or has an invalid future timestamp.",
      );
      continue;
    }
    const q = quotes.find((q) => q.marketId === t.marketId),
      entry = q ? (t.side === "yes" ? q.yes : q.no) : null;
    if (
      !q ||
      now - q.retrievedAt > 20000 ||
      q.status !== "open" ||
      q.result ||
      q.closeTime * 1000 <= now ||
      !["polymarket", "gx"].includes(q.provider) ||
      !entry
    ) {
      skip("A fresh, supported open-market buy quote is unavailable.");
      continue;
    }
    const price = BigInt(entry),
      signal = BigInt(t.priceUsd);
    if (
      price <= 0n ||
      price >= scale ||
      signal <= 0n ||
      price * 10000n > signal * 10500n
    ) {
      skip(
        "Current entry is invalid or more than 5% above the observed trade price.",
      );
      continue;
    }
    const active = p.positions.filter((x) => !x.settled),
      used = active
        .filter((x) => x.owner === t.ownerPubkey)
        .reduce((s, x) => s + BigInt(x.cost), 0n),
      eventUsed = active
        .filter((x) => x.eventId === t.eventId)
        .reduce((s, x) => s + BigInt(x.cost), 0n);
    if (active.some((x) => x.marketId === t.marketId)) {
      skip(
        "This market already has a portfolio position; duplicate and opposing copies are blocked.",
      );
      continue;
    }
    const amounts = [
        budget / 20n,
        callerCap - used,
        budget / 10n - eventUsed,
        BigInt(p.cash) - reserve,
      ],
      stake = amounts.reduce((a, b) => (a < b ? a : b));
    if (stake < 5000000n) {
      skip("Caller, event, reserve or $5 minimum budget limit reached.");
      continue;
    }
    const contracts = (stake * scale) / price,
      cost = (contracts * price + scale - 1n) / scale;
    p.positions.push({
      id: t.id,
      owner: t.ownerPubkey,
      marketId: t.marketId,
      eventId: t.eventId,
      title: t.eventTitle + " ? " + t.marketTitle,
      side: t.side,
      cost: String(cost),
      contracts: String(contracts),
      entry: String(price),
      settled: false,
      payout: null,
    });
    p.cash = String(BigInt(p.cash) - cost);
    note(
      t.id,
      t.eventTitle + " ? " + t.marketTitle,
      "Paper entry",
      "Indicative buy quote; depth, execution and fees are not verified.",
    );
  }
  p.journal = p.journal.slice(0, 300);
  return p;
}
