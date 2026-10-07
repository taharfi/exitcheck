import { SCALE, units } from "../../lib/amounts";
import type { Depth, Estimate } from "./types";
export const MAX_SNAPSHOT_AGE = 20_000;
export function assertFresh(capturedAt: number, now = Date.now()) {
  if (now - capturedAt > MAX_SNAPSHOT_AGE || capturedAt > now + 1000)
    throw new Error("Snapshot expired. Refresh the exit preview.");
}
export function calculateExit(input: {
  quantity: string;
  held: string;
  isYes: boolean;
  depth: Depth;
  referencePrice: string | null;
  fee?: string | null;
  now?: number;
}): Estimate {
  assertFresh(input.depth.capturedAt, input.now);
  const requested = units(input.quantity),
    held = units(input.held);
  if (requested === 0n || requested > held)
    throw new Error(
      "Quantity must be greater than zero and no greater than your position.",
    );
  const levels = [...(input.isYes ? input.depth.yes : input.depth.no)]
    .filter((level) => units(level.quantity) > 0n)
    .sort((a, b) =>
      units(a.price) > units(b.price)
        ? -1
        : units(a.price) < units(b.price)
          ? 1
          : 0,
    );
  let left = requested,
    numerator = 0n;
  for (const level of levels) {
    const price = units(level.price),
      available = units(level.quantity);
    if (price > SCALE) throw new Error("Price exceeds $1 per contract.");
    const take = left < available ? left : available;
    numerator += take * price;
    left -= take;
    if (left === 0n) break;
  }
  const fill = requested - left,
    gross = numerator / SCALE;
  const fee = input.fee == null ? null : units(input.fee);
  if (fee !== null && fee > gross)
    throw new Error("Fees exceed estimated proceeds.");
  const ref =
    input.referencePrice === null ? null : units(input.referencePrice);
  const reference = ref === null ? null : (ref * requested) / SCALE;
  // Size impact compares the weighted fill with the best available same-side bid.
  // Mark valuation is a separate reference; its gap to the best bid is not size impact.
  const bestBid = levels.length > 0 ? units(levels[0].price) : null;
  const filledReference = bestBid === null ? null : (bestBid * fill) / SCALE;
  const impact =
    filledReference && filledReference >= gross
      ? ((filledReference - gross) * 10_000n) / filledReference
      : null;
  return {
    requested: requested.toString(),
    fillable: fill.toString(),
    gross: gross.toString(),
    fee: fee?.toString() ?? null,
    net: fee === null ? null : (gross - fee).toString(),
    remaining: (held - fill).toString(),
    averagePrice: fill > 0n ? (numerator / fill).toString() : null,
    referenceValue: reference?.toString() ?? null,
    impactBps: impact?.toString() ?? null,
    impactReferencePrice: bestBid?.toString() ?? null,
    insufficient: left > 0n,
    capturedAt: input.depth.capturedAt,
  };
}
