import nextEnv from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import {
  JupiterProvider,
  parseProviderJson,
} from "../../src/lib/provider/jupiter";
import {
  marketSchema,
  parseDepth,
  parsePosition,
  address,
} from "../../src/lib/provider/schemas";
import { calculateExit } from "../../src/features/exits/calculations";
import { VersionedTransaction } from "@solana/web3.js";
nextEnv.loadEnvConfig(process.cwd());
const args = process.argv.slice(2);
const arg = (name: string) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const publicRead = args.includes("--public-read");
const api = new JupiterProvider();
async function request(path: string) {
  if (!publicRead) return api.request(path);
  // Explicit experiment: docs require a key; never treat anonymous access as a production contract.
  const response = await fetch(`https://api.jup.ag/prediction/v1${path}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      `Read-only probe HTTP ${response.status}. Configure JUPITER_API_KEY.`,
    );
  const text = await response.text();
  if (args.includes("--capture")) {
    mkdirSync("docs/provider-source", { recursive: true });
    writeFileSync(
      `docs/provider-source/probe-${path.split("?")[0].split("/")[1]}.json`,
      text,
    );
  }
  return parseProviderJson(text);
}
async function main() {
  const events = z
    .object({
      data: z.array(
        z.object({ markets: z.array(z.object({ marketId: z.string() })) }),
      ),
    })
    .parse(await request("/events?includeMarkets=true&start=0&end=3"));
  const marketId =
    arg("--market") ?? events.data.flatMap((e) => e.markets)[0]?.marketId;
  if (!marketId) throw new Error("No real market returned.");
  const [rawMarket, rawBook, status] = await Promise.all([
    (await request(`/markets/${encodeURIComponent(marketId)}`)),
    (await request(`/orderbook/${encodeURIComponent(marketId)}`)),
    (await request("/trading-status")),
  ]);
  const market = marketSchema.parse(rawMarket),
    depth = parseDepth(rawBook);
  const quantity = arg("--quantity-micro") ?? "120000000";
  const estimate = calculateExit({
    quantity,
    held: quantity,
    isYes: !args.includes("--no"),
    depth,
    referencePrice: null,
  });
  console.log(
    JSON.stringify(
      {
        evidence: "LIVE READ-ONLY DATA",
        access: publicRead
          ? "Anonymous experiment (not documented access)"
          : "API key",
        market: {
          id: market.marketId,
          title: market.title,
          status: market.status,
          result: market.result,
        },
        trading: status,
        levels: { yes: depth.yes.length, no: depth.no.length },
        estimate,
      },
      null,
      2,
    ),
  );
  const positionId = arg("--position");
  if (positionId) {
    address.parse(positionId);
    const position = parsePosition(await request(`/positions/${positionId}`));
    console.log(
      JSON.stringify({
        position: "Live position verified",
        side: position.isYes ? "YES" : "NO",
        quantity: position.quantity,
        claimed: position.claimed,
        claimable: position.claimable,
      }),
    );
    if (args.includes("--prepare")) {
      if (publicRead)
        throw new Error(
          "Unsigned preparation uses the documented API-key path. Remove --public-read and configure JUPITER_API_KEY.",
        );
      const built = await api.buildSell(position, quantity);
      const tx = VersionedTransaction.deserialize(
        Buffer.from(built.transaction, "base64"),
      );
      console.log(
        JSON.stringify({
          evidence: "LIVE UNSIGNED BUILD — NOT SIGNED OR SUBMITTED",
          orderId: built.order.orderPubkey,
          quantity: built.order.contractsMicro,
          fee: built.order.estimatedTotalFeeUsd,
          floor: built.order.minSellPriceUsd,
          signerCount: tx.message.header.numRequiredSignatures,
          blockhashMatches:
            tx.message.recentBlockhash === built.txMeta.blockhash,
        }),
      );
    }
  }
  const order = arg("--order");
  if (order) {
    address.parse(order);
    const status = await api.orderStatus(order);
    console.log(JSON.stringify({ evidence: "EXISTING ORDER READ", status }));
  } else
    console.log(
      "Order lifecycle probe skipped: provide --order with an existing order pubkey. No execution was performed.",
    );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Probe failed");
  process.exitCode = 1;
});
