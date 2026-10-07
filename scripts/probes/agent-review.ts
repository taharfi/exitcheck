import nextEnv from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { JupiterProvider } from "../../src/lib/provider/jupiter";
import { marketSchema, integer, address } from "../../src/lib/provider/schemas";
import { inspectAgentEntry } from "../../src/features/copy-trading/agent-review";
import type { AgentDecision } from "../../src/features/copy-trading/agent-model";
import { parseJupiterMarkets } from "../../src/features/prediction-bot/market-feeds";
import {
  readWalletFunds,
  readWalletExposure,
  evaluateWalletReview,
} from "../../src/features/copy-trading/agent-wallet";

nextEnv.loadEnvConfig(process.cwd());
const provider = new JupiterProvider();
const quotedMarket = marketSchema.extend({
  eventId: z.string().min(1),
  pricing: z.object({ buyYesPriceUsd: integer.nullable() }).nullable(),
});
try {
  const catalog = parseJupiterMarkets(
    await provider.request(
      "/events?category=crypto&filter=trending&includeMarkets=true&start=0&end=12",
    ),
  );
  const marketId =
    process.argv[2] ??
    catalog.find(
      (market) =>
        market.status === "open" &&
        market.ask !== null &&
        market.closesAt !== null &&
        market.closesAt > Date.now(),
    )?.id;
  if (!marketId) throw Error("No market returned for the read-only probe.");
  const market = quotedMarket.parse(
    await provider.request("/markets/" + encodeURIComponent(marketId)),
  );
  const leaderPrice = market.pricing?.buyYesPriceUsd;
  if (
    market.status !== "open" ||
    market.result !== null ||
    market.closeTime * 1000 <= Date.now() ||
    !leaderPrice ||
    BigInt(leaderPrice) <= 0n ||
    BigInt(leaderPrice) >= 1_000_000n
  )
    throw Error("Select an open market with an indicative YES price.");
  const now = Date.now();
  const decision: AgentDecision = {
    id: randomUUID(),
    planId: randomUUID(),
    sourceId: "hypothetical-probe",
    sourceSignature: null,
    sourceAt: now,
    observedAt: now,
    expiresAt: now + 120000,
    marketId: market.marketId,
    eventId: market.eventId,
    title: market.title,
    side: "yes",
    action: "buy",
    leaderPrice,
    leaderContracts: "0",
    quotePrice: null,
    quoteAt: null,
    allocation: "10000000",
    status: "review",
    reason:
      "Hypothetical $10 planning probe; no trader fill or wallet balance.",
  };
  const review = await inspectAgentEntry(decision, (path) =>
    provider.request(path),
  );
  const walletIndex = process.argv.indexOf("--wallet");
  const publicWallet =
    walletIndex >= 0 ? address.parse(process.argv[walletIndex + 1]) : null;
  if (publicWallet) {
    const [funds, exposure] = await Promise.all([
      readWalletFunds(publicWallet).catch(() => null),
      readWalletExposure(publicWallet, decision, (path) =>
        provider.request(path),
      ).catch(() => null),
    ]);
    review.wallet = evaluateWalletReview(
      { budget: "100000000" },
      decision,
      "USDC",
      funds,
      exposure,
      { total: 10000000n, events: new Map([[decision.eventId, 10000000n]]) },
    );
  }
  const evidence = {
    evidence: "Live provider reads with a hypothetical $10 proposal",
    capturedAt: new Date().toISOString(),
    marketId,
    publicWallet,
    assumptions:
      "YES side and $10 allocation are hypothetical; source fill is set to the initial indicative quote. No actual trader fill or funded entry. When publicWallet is provided, its balances and positions are actual read-only observations.",
    review,
    ordersPrepared: 0,
    ordersSubmitted: 0,
    plansSaved: 0,
  };
  mkdirSync("docs/research", { recursive: true });
  writeFileSync(
    "docs/research/agent-review-probe.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence, null, 2));
  if (review.entry.quotePrice === null || review.exit.estimate === null)
    throw Error(
      "The live quote or orderbook remains unverified; see evidence.",
    );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Read-only probe failed",
  );
  process.exitCode = 1;
}
