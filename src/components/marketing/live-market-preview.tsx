"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { marketFeedSchema, type MarketFeed } from "@/features/trade/types";
import styles from "./landing.module.css";

export function LiveMarketPreview() {
  const [feed, setFeed] = useState<MarketFeed | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    async function refresh() {
      if (running || document.hidden) return;
      running = true;
      try {
        const response = await fetch("/api/trade?limit=3", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Unavailable");
        const next = marketFeedSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setFeed(next);
          setError(false);
        }
      } catch {
        if (!controller.signal.aborted) {
          setFeed(null);
          setError(true);
        }
      } finally {
        running = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);
  return (
    <section className={styles.livePreview} aria-label="Live market preview">
      <div className={styles.previewHeading}>
        <span>LIVE MARKET SNAPSHOTS</span>
        <span>30s refresh</span>
      </div>
      {error ? (
        <p role="status">
          Live market data is unavailable. Open the terminal to retry.
        </p>
      ) : !feed ? (
        <p role="status">Loading live markets...</p>
      ) : !feed.markets.length ? (
        <p role="status">
          No current contracts available. No example markets are substituted.
        </p>
      ) : (
        <>
          {feed.markets.slice(0, 3).map((m) => (
            <Link key={m.id} href="/trade" className={styles.previewMarket}>
              <small>
                {m.dataProvider === "panta"
                  ? "PANTA / SOLANA"
                  : m.source === "solana"
                    ? "SOLANA"
                    : "POLYMARKET"}{" "}
                / {m.dataProvider.toUpperCase()}
              </small>
              <h3>{m.question}</h3>
              <div>
                <span>
                  YES{" "}
                  <b>
                    {m.yesPrice === null
                      ? "Unavailable"
                      : `${(m.yesPrice * 100).toFixed(1)}%`}
                  </b>
                </span>
                <span>
                  NO{" "}
                  <b>
                    {m.noPrice === null
                      ? "Unavailable"
                      : `${(m.noPrice * 100).toFixed(1)}%`}
                  </b>
                </span>
              </div>
            </Link>
          ))}
          <small>
            Provider snapshot:{" "}
            {new Date(feed.capturedAt)
              .toISOString()
              .replace("T", " ")
              .slice(0, 19)}{" "}
            UTC
          </small>
          {feed.markets.some((market) => market.dataProvider === "panta") && (
            <a
              href="https://panta.market"
              target="_blank"
              rel="noopener noreferrer"
            >
              Powered by Panta
            </a>
          )}
        </>
      )}
      {feed?.warnings.map((w) => (
        <p key={w} role="status">
          {w}
        </p>
      ))}
      <Link className={styles.previewCta} href="/trade">
        Research a market
      </Link>
      <small>Live quotes. Simulated orders. No automatic execution.</small>
    </section>
  );
}
