export type Exposure = {
  id: string;
  owner: string;
  eventId: string | null;
  marketId: string;
  title: string;
  side: "yes" | "no";
  value: string | null;
};
export function summarizeOverlap(positions: Exposure[]) {
  const groups = new Map<string, Exposure[]>();
  for (const p of new Map(
    positions.map((p) => [p.owner + ":" + p.id, p]),
  ).values()) {
    const key = p.eventId ? "event:" + p.eventId : "market:" + p.marketId;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.entries()].flatMap(([key, ps]) => {
    const owners = [...new Set(ps.map((p) => p.owner))];
    if (owners.length < 2) return [];
    const markets = new Map<string, Set<string>>();
    for (const p of ps) {
      const sides = markets.get(p.marketId) ?? new Set<string>();
      sides.add(p.side);
      markets.set(p.marketId, sides);
    }
    return [
      {
        key,
        title: ps[0].title,
        owners,
        positions: ps.length,
        eventVerified: Boolean(ps[0].eventId),
        opposingSides: [...markets.values()].some((s) => s.size > 1),
        markedValue: ps.every((p) => p.value !== null)
          ? String(ps.reduce((sum, p) => sum + BigInt(p.value!), 0n))
          : null,
      },
    ];
  });
}
