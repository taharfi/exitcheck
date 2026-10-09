import { randomUUID } from "node:crypto";
import type { AsyncDatabase } from "@/lib/server/sqlite";
import { shadowStore } from "../copy-trading/shadow-store";
import {
  loadFeed,
  refreshRoute,
  underlyingMarket,
  verifyUnderlying,
  type Feed,
  type FeedMarket,
} from "./market-feeds";
export type MarketPoint = {
  exitDepth?: import("@/features/exits/types").Depth;
  depthError?: string;
  at: number;
  routeAt?: number;
  externalAt?: number | null;
  route: FeedMarket;
  external: FeedMarket | null;
  verified: boolean;
  independent: boolean;
  reason: string;
};
export class MarketRecorder {
  constructor(readonly db: AsyncDatabase) {
    db.initialize(`CREATE TABLE IF NOT EXISTS market_feeds(source TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS market_points(id INTEGER PRIMARY KEY,market TEXT NOT NULL,at INTEGER NOT NULL,body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS market_points_market_time ON market_points(market,at);
      CREATE TABLE IF NOT EXISTS market_recording_lease(id INTEGER PRIMARY KEY CHECK(id=1),token TEXT NOT NULL,until INTEGER NOT NULL);`);
    db.initialize(
      "CREATE TABLE IF NOT EXISTS market_cohort(id TEXT PRIMARY KEY,body TEXT NOT NULL)",
    );
  }
  async feeds(): Promise<Feed[]> {
    return await this.db.session(async () => {
      return (
        (await this.db
          .prepare("SELECT body FROM market_feeds ORDER BY source")
          .all()) as { body: string }[]
      ).map((r) => JSON.parse(r.body));
    });
  }
  async saveFeed(feed: Feed) {
    return await this.db.session(async () => {
      await this.db
        .prepare(
          "INSERT INTO market_feeds VALUES(?,?) ON CONFLICT(source) DO UPDATE SET body=excluded.body",
        )
        .run(feed.source, JSON.stringify(feed));
    });
  }
  async append(point: MarketPoint) {
    return await this.db.session(async () => {
      await this.db
        .prepare("INSERT INTO market_points(market,at,body) VALUES(?,?,?)")
        .run(point.route.id, point.at, JSON.stringify(point));
    });
  }
  async points(): Promise<MarketPoint[]> {
    return await this.db.session(async () => {
      return (
        (await this.db
          .prepare(
            "SELECT body FROM (SELECT id,body FROM market_points ORDER BY id DESC LIMIT 10000) ORDER BY id",
          )
          .all()) as { body: string }[]
      ).map((r) => JSON.parse(r.body));
    });
  }
  async acquire(now: number) {
    return await this.db.session(async () => {
      const token = randomUUID();
      return (
        await this.db
          .prepare(
            "INSERT INTO market_recording_lease VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,until=excluded.until WHERE market_recording_lease.until<?",
          )
          .run(token, now + 300000, now)
      ).changes
        ? token
        : null;
    });
  }
  async release(token: string) {
    return await this.db.session(async () => {
      await this.db
        .prepare("DELETE FROM market_recording_lease WHERE token=?")
        .run(token);
    });
  }
}
export function marketRecorder() {
  return new MarketRecorder(shadowStore().db);
}
export async function collectMarkets(
  store = marketRecorder(),
  loader = loadFeed,
  underlying = underlyingMarket,
  refresh = refreshRoute,
  enrich: (point: MarketPoint) => Promise<MarketPoint> = async (point) => point,
) {
  const token = await store.acquire(Date.now());
  if (!token) return { collected: false, reason: "Collector already running." };
  try {
    const feeds = await Promise.all([
      loader("jupiter"),
      loader("polymarket"),
      loader("kalshi"),
    ]);
    for (const feed of feeds) await store.saveFeed(feed);
    const existing = (
      (await store.db
        .prepare("SELECT body FROM market_cohort ORDER BY rowid")
        .all()) as { body: string }[]
    ).map((r) => JSON.parse(r.body) as FeedMarket);
    const routes = existing.length
      ? existing
      : (feeds
          .find((f) => f.source === "jupiter")
          ?.markets.filter(
            (m) =>
              m.status === "open" &&
              m.closesAt !== null &&
              m.closesAt > Date.now() &&
              m.tokenIds.length === 2 &&
              m.bid !== null &&
              m.ask !== null &&
              BigInt(m.bid) >= 50000n &&
              BigInt(m.ask) <= 950000n &&
              BigInt(m.bid) <= BigInt(m.ask),
          )
          .slice(0, 4) ?? []);
    if (!existing.length)
      for (const route of routes)
        await store.db
          .prepare("INSERT OR IGNORE INTO market_cohort VALUES(?,?)")
          .run(route.id, JSON.stringify(route));
    for (const route of routes) {
      let current = route,
        routeAt = feeds.find((f) => f.source === "jupiter")!.at;
      if (existing.length) {
        try {
          current = await refresh(route);
          routeAt = Date.now();
        } catch {
          current = { ...route, status: "unavailable", bid: null, ask: null };
          routeAt = Date.now();
        }
      }
      let external: FeedMarket | null = null;
      try {
        external = await underlying(current);
      } catch {
        /* Keep the gap visible; never reuse an old reference quote. */
      }
      const checked =
        current.status !== "unavailable" && external
          ? verifyUnderlying(current, external)
          : {
              verified: false,
              independent: false,
              reason: "Direct underlying market unavailable. Entry blocked.",
            };
      await store.append(
        await enrich({
          at: Date.now(),
          routeAt,
          externalAt: external ? Date.now() : null,
          route: current,
          external,
          ...checked,
        }),
      );
    }
    await store.db
      .prepare("DELETE FROM market_points WHERE at<?")
      .run(Date.now() - 30 * 86400000);
    await store.db.exec(
      "DELETE FROM market_points WHERE id < (SELECT MAX(id)-9999 FROM market_points)",
    );
    return { collected: true, cohort: routes.length };
  } finally {
    await store.release(token);
  }
}
export function startMarketRecorder() {
  const state = globalThis as typeof globalThis & {
    exitcheckMarketTimer?: ReturnType<typeof setInterval>;
  };
  if (state.exitcheckMarketTimer) return;
  const tick = () => {
    void collectMarkets().catch(() => console.error("market_recording_failed"));
  };
  tick();
  state.exitcheckMarketTimer = setInterval(tick, 60000);
  state.exitcheckMarketTimer.unref();
}
