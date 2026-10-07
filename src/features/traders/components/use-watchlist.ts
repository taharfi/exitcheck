"use client";
import { useMemo, useState, useSyncExternalStore } from "react";
import {
  WATCHLIST_KEY,
  parseWatchlist,
  toggleSaved,
} from "@/features/traders/watchlist";
function snapshot() {
  try {
    return localStorage.getItem(WATCHLIST_KEY) ?? "[]";
  } catch {
    return "__unavailable__";
  }
}
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("exitcheck-watchlist", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("exitcheck-watchlist", callback);
  };
}
export function useWatchlist() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "[]"),
    [error, setError] = useState("");
  const parsed = useMemo(() => {
    try {
      return { wallets: parseWatchlist(raw), problem: "" };
    } catch {
      return {
        wallets: [] as string[],
        problem: "Saved watchlist could not be read in this browser.",
      };
    }
  }, [raw]);
  function toggle(owner: string) {
    try {
      const next = toggleSaved(parsed.wallets, owner);
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event("exitcheck-watchlist"));
      setError("");
    } catch {
      setError(
        "Could not save this watchlist. Browser storage may be unavailable or the 100-wallet limit was reached.",
      );
    }
  }
  return { wallets: parsed.wallets, toggle, error: error || parsed.problem };
}
