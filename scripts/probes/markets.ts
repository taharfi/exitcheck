import nextEnv from "@next/env";
import { openSqlite } from "../../src/lib/server/sqlite";
import {
  collectMarkets,
  MarketRecorder,
} from "../../src/features/prediction-bot/market-recorder";
import { JupiterProvider } from "../../src/lib/provider/jupiter";
import { parseJupiterMarkets } from "../../src/features/prediction-bot/market-feeds";
nextEnv.loadEnvConfig(process.cwd());
try {
  const raw = await new JupiterProvider().request(
    "/events?category=crypto&filter=trending&includeMarkets=true&start=0&end=12",
  );
  console.log("Jupiter parsed", parseJupiterMarkets(raw).length);
} catch (e) {
  console.log(
    "Jupiter diagnostics",
    e instanceof Error ? e.message : "unavailable",
  );
}
const db = openSqlite(":memory:");
const store = new MarketRecorder(db);
await collectMarkets(store);
await collectMarkets(store);
console.log(
  JSON.stringify(
    {
      feeds: (await store.feeds()).map((f) => ({
        source: f.source,
        count: f.markets.length,
        error: f.error,
      })),
      points: (await store.points()).map((p) => ({
        id: p.route.id,
        title: p.route.title,
        verified: p.verified,
        status: p.route.status,
        reason: p.reason,
        routeRules: p.route.rules.slice(0, 100),
        externalRules: p.external?.rules.slice(0, 100),
      })),
    },
    null,
    2,
  ),
);
db.close();
