import nextEnv from "@next/env";
import { z } from "zod";
import { mkdirSync, writeFileSync } from "node:fs";
import { JupiterProvider } from "../../src/lib/provider/jupiter";
import { address } from "../../src/lib/provider/schemas";
import { AppError } from "../../src/lib/errors";
import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  rpc,
  assertMainnet,
  USDC,
} from "../../src/features/exits/transactions";
import { readWalletFunds } from "../../src/features/copy-trading/agent-wallet";
import { parseProviderJson } from "../../src/lib/provider/jupiter";
import { readLimitedText } from "../../src/lib/read-limited-text";

// Discovery only: no signing, order submission or private plan changes.
nextEnv.loadEnvConfig(process.cwd());
const market = z.object({
  marketId: z.string().max(128),
  provider: z.literal("bisonfi"),
  tradable: z.boolean(),
  outcomeMint: address,
  openTime: z.number().finite().optional(),
  closeTime: z.number().finite(),
  status: z.string().max(32),
});
let stage = "discovery";
let providerFailure: {
  status: number;
  code: string | null;
  topics?: string[];
} | null = null;
async function main() {
  const provider = new JupiterProvider(undefined, async (url, options) => {
    const response = await fetch(url, options);
    if (!response.ok) {
      const body = await readLimitedText(
        response.clone(),
        20000,
        () =>
          new AppError(
            "DIAGNOSTIC_RESPONSE_TOO_LARGE",
            "Error response exceeds limit.",
            502,
          ),
      );
      let code: string | null = null;
      try {
        const value = JSON.parse(body);
        if (
          typeof value.code === "string" &&
          /^[a-z0-9_]{1,80}$/.test(value.code)
        )
          code = value.code;
      } catch {
        /* Arbitrary error bodies remain private. */
      }
      providerFailure = { status: response.status, code };
    }
    return response;
  });
  const response = z
    .object({
      data: z
        .array(z.object({ markets: z.array(market).default([]) }))
        .max(100),
      pagination: z.object({
        total: z
          .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
          .optional(),
        hasNext: z.boolean(),
      }),
    })
    .parse(
      await provider.request(
        "/events?provider=bisonfi&category=crypto&tags=15m&filter=live&sortBy=beginAt&sortDirection=desc&includeMarkets=true&start=0&end=100",
      ),
    );
  const markets = response.data.flatMap((e) => e.markets);
  const sideIndex = process.argv.indexOf("--side");
  const side =
    sideIndex < 0
      ? "DOWN"
      : z.enum(["UP", "DOWN"]).parse(process.argv[sideIndex + 1]);
  const selected = markets.find(
    (m) =>
      m.marketId.endsWith(`-${side}`) &&
      m.tradable &&
      m.status === "open" &&
      m.closeTime * 1000 > Date.now() &&
      (m.openTime ?? Infinity) * 1000 <= Date.now(),
  );
  const walletIndex = process.argv.indexOf("--wallet");
  let buildEvidence: unknown = null;
  if (walletIndex >= 0) {
    stage = "market_selection";
    const owner = address.parse(process.argv[walletIndex + 1]);
    if (!selected) throw Error("No live Forecast round available.");
    stage = "wallet_funds";
    const funds = await readWalletFunds(owner);
    if (
      !funds.balances.USDC ||
      BigInt(funds.balances.USDC) < 5000000n ||
      !funds.solLamports ||
      BigInt(funds.solLamports) <= 0n
    )
      throw Error("Owner cannot cover diagnostic funding.");
    const connection = rpc();
    await assertMainnet(connection);
    const mint = await connection.getAccountInfo(
      new PublicKey(selected.outcomeMint),
      "confirmed",
    );
    if (
      !mint ||
      mint.owner.toBase58() !== "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
    )
      throw Error("Unexpected outcome token program.");
    stage = "prediction_build";
    const prediction = process.argv.includes("--direct-swap")
      ? null
      : z
          .object({
            transaction: z.string().min(1).max(50000),
            executionModel: z.string(),
            execution: z.object({ context: z.unknown() }),
            settlement: z.string(),
          })
          .parse(
            await provider.request("/orders", "POST", {
              ownerPubkey: owner,
              marketId: selected.marketId,
              isYes: true,
              isBuy: true,
              depositAmount: "5000000",
              depositMint: USDC,
            }),
          );
    stage = "swap_build";
    const params = new URLSearchParams({
      inputMint: USDC,
      outputMint: selected.outcomeMint,
      amount: "5000000",
      taker: owner,
      slippageBps: "50",
      swapMode: "ExactIn",
    });
    const swapResponse = await fetch(
      `https://api.jup.ag/swap/v2/order?${params}`,
      {
        headers: { "x-api-key": process.env.JUPITER_API_KEY! },
        signal: AbortSignal.timeout(10000),
        cache: "no-store",
      },
    );
    if (!swapResponse.ok) {
      const text = await readLimitedText(
        swapResponse,
        20000,
        () =>
          new AppError(
            "DIAGNOSTIC_RESPONSE_TOO_LARGE",
            "Error response exceeds limit.",
            502,
          ),
      );
      let code: string | null = null;
      try {
        const body = JSON.parse(text);
        const candidate = body.code ?? body.errorCode ?? body.error;
        if (
          typeof candidate === "string" &&
          /^[a-z0-9_]{1,80}$/i.test(candidate)
        )
          code = candidate;
      } catch {
        /* Arbitrary errors are not logged. */
      }
      providerFailure = {
        status: swapResponse.status,
        code,
        topics: [
          "slippage",
          "liquidity",
          "route",
          "token",
          "mint",
          "balance",
          "unsupported",
          "amount",
          "taker",
          "invalid",
          "market",
          "expired",
          "quote",
          "disabled",
          "dex",
        ].filter((word) => text.toLowerCase().includes(word)),
      };
      throw new AppError(
        "SWAP_BUILD_FAILED",
        "Unsigned swap build unavailable.",
        502,
      );
    }
    const swap = z
      .object({
        transaction: z.string().min(1).max(50000),
        inAmount: z.string().regex(/^\d+$/),
        outAmount: z.string().regex(/^\d+$/),
        otherAmountThreshold: z.string().regex(/^\d+$/),
        slippageBps: z.coerce.number().int(),
        router: z.string(),
        inputMint: address,
        outputMint: address,
        swapMode: z.literal("ExactIn"),
      })
      .parse(
        parseProviderJson(
          await readLimitedText(
            swapResponse,
            2000000,
            () =>
              new AppError(
                "DIAGNOSTIC_RESPONSE_TOO_LARGE",
                "Oversize swap response.",
                502,
              ),
          ),
        ),
      );
    if (
      swap.inAmount !== "5000000" ||
      swap.inputMint !== USDC ||
      swap.outputMint !== selected.outcomeMint ||
      swap.slippageBps !== 50
    )
      throw Error("Swap quote differs from diagnostic request.");
    const inspect = async (encoded: string, name: string) => {
      const tx = VersionedTransaction.deserialize(
        Buffer.from(encoded, "base64"),
      );
      const tables = await Promise.all(
        tx.message.addressTableLookups.map(async (l) => {
          const table = await connection.getAddressLookupTable(l.accountKey);
          if (!table.value) throw Error("Missing lookup table.");
          return table.value;
        }),
      );
      const message = TransactionMessage.decompile(tx.message, {
        addressLookupTableAccounts: tables,
      });
      const simulation = await connection.simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: false,
        commitment: "confirmed",
      });
      mkdirSync("data/forecast-probe", { recursive: true });
      writeFileSync(`data/forecast-probe/${name}.tx`, tx.serialize());
      return {
        requiredSigners: tx.message.header.numRequiredSignatures,
        feePayerMatches: message.payerKey.toBase58() === owner,
        simulationSuccess: simulation.value.err === null,
        instructions: message.instructions.map((i) => ({
          program: i.programId.toBase58(),
          dataBytes: i.data.length,
          accounts: i.keys.length,
          discriminator: i.data.subarray(0, 8).toString("hex"),
          routePrefix:
            i.programId.toBase58() ===
            "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
              ? Array.from(i.data.subarray(8, i.data.length - 19))
              : null,
          routeTail:
            i.programId.toBase58() ===
              "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4" &&
            i.data.length >= 27
              ? {
                  inAmount: i.data
                    .readBigUInt64LE(i.data.length - 19)
                    .toString(),
                  quotedOutAmount: i.data
                    .readBigUInt64LE(i.data.length - 11)
                    .toString(),
                  slippageBps: i.data.readUInt16LE(i.data.length - 3),
                  feeBps: i.data[i.data.length - 1],
                }
              : null,
        })),
      };
    };
    buildEvidence = {
      marketId: selected.marketId,
      mintDataBytes: mint.data.length,
      prediction: prediction
        ? {
            executionModel: prediction.executionModel,
            settlement: prediction.settlement,
            inspection: await inspect(prediction.transaction, "prediction"),
          }
        : { skipped: true },
      swap: {
        router: swap.router,
        inAmount: swap.inAmount,
        outAmount: swap.outAmount,
        otherAmountThreshold: swap.otherAmountThreshold,
        slippageBps: swap.slippageBps,
        inspection: await inspect(swap.transaction, "swap"),
      },
      instructionPolicyVerified: false,
      signingEnabled: false,
      ordersSubmitted: 0,
    };
  }
  const evidence = {
    capturedAt: new Date().toISOString(),
    provider: "bisonfi",
    pagination: response.pagination,
    markets,
    currentlyTradable: markets.filter(
      (m) =>
        m.tradable &&
        m.closeTime * 1000 > Date.now() &&
        (m.openTime ?? Infinity) * 1000 <= Date.now(),
    ).length,
    buildEvidence,
    signingEnabled: false,
    ordersSubmitted: 0,
  };
  mkdirSync("docs/research", { recursive: true });
  writeFileSync(
    "docs/research/forecast-probe.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        ...evidence,
        markets: undefined,
        marketsInspected: markets.length,
        latestCloseTime: markets.length
          ? new Date(
              Math.max(...markets.map((m) => m.closeTime)) * 1000,
            ).toISOString()
          : null,
      },
      null,
      2,
    ),
  );
}
main().catch((error) => {
  const evidence = {
    capturedAt: new Date().toISOString(),
    failed: true,
    stage,
    providerFailure,
    code:
      error instanceof AppError
        ? error.code
        : error instanceof z.ZodError
          ? "INVALID_DISCOVERY_SCHEMA"
          : "DISCOVERY_FAILED",
    schemaPaths:
      error instanceof z.ZodError
        ? error.issues.map((i) => i.path.join("."))
        : [],
    signingEnabled: false,
    ordersSubmitted: 0,
  };
  mkdirSync("docs/research", { recursive: true });
  writeFileSync(
    "docs/research/forecast-probe.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.error(JSON.stringify(evidence));
  process.exitCode = 1;
});
