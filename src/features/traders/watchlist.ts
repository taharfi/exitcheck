import { z } from "zod";
export const WATCHLIST_KEY = "exitcheck-watchlist-v1";
export const savedWalletsSchema = z
  .array(z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/))
  .max(100)
  .refine((xs) => new Set(xs).size === xs.length);
export function parseWatchlist(raw: string) {
  return savedWalletsSchema.parse(JSON.parse(raw));
}
export function toggleSaved(wallets: string[], owner: string) {
  return savedWalletsSchema.parse(
    wallets.includes(owner)
      ? wallets.filter((x) => x !== owner)
      : [...wallets, owner],
  );
}
