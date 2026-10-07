import nextEnv from "@next/env";
import {
  Keypair,
  VersionedTransaction,
  TransactionMessage,
} from "@solana/web3.js";
import { writeFileSync } from "node:fs";
import { z } from "zod";
import { JupiterProvider } from "../../src/lib/provider/jupiter";
import { readWalletFunds } from "../../src/features/copy-trading/agent-wallet";
import { readLimitedText } from "../../src/lib/read-limited-text";
import { AppError } from "../../src/lib/errors";
import { auditBuildSignatures } from "../../src/features/copy-trading/agent-build-signatures";
import { simulationBalanceChanges } from "../../src/features/copy-trading/agent-simulation-balances";
import {
  marketSchema,
  integer,
  address,
  txMetaSchema,
} from "../../src/lib/provider/schemas";
import {
  rpc,
  assertMainnet,
  USDC,
} from "../../src/features/exits/transactions";

// Developer diagnostic only. An explicit public owner may be inspected;
// no wallet signing or submission API is used.
nextEnv.loadEnvConfig(process.cwd());
let stage = "catalog";
let walletCheck: {
  usdc: "unknown" | "below_minimum" | "minimum_met";
  sol: "unknown" | "zero" | "present";
} | null = null;
let failure: { status: number; reason: string } | null = null;
const provider = new JupiterProvider(undefined, async (url, options) => {
  const response = await fetch(url, options);
  failure = null;
  if (!response.ok) {
    const text = await readLimitedText(
      response.clone(),
      20000,
      () =>
        new AppError(
          "DIAGNOSTIC_RESPONSE_TOO_LARGE",
          "Diagnostic error body exceeded the limit.",
          502,
        ),
    );
    // Classify the error without exposing an arbitrary provider body or credentials.
    failure = {
      status: response.status,
      reason:
        /insufficient.*(funds|balance)|not enough.*(funds|balance|USDC|SOL)|balance.*(insufficient|too low)/i.test(
          text,
        )
          ? "The requested owner cannot cover the required balance."
          : /minimum order|minimum.*deposit/i.test(text)
            ? "The provider rejected the minimum order amount."
            : /token account|associated token|account.*not.*found/i.test(text)
              ? "The requested owner's required token account is unavailable."
              : "The provider rejected this diagnostic request; exact reason remains unverified.",
    };
  }
  return response;
});
const args = process.argv.slice(2);
const argument = (name: string) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const publicWallet = argument("--wallet");
if (args.includes("--wallet") && !publicWallet)
  throw Error("Provide a public address after --wallet.");
const owner = publicWallet
  ? address.parse(publicWallet)
  : Keypair.generate().publicKey.toBase58();
const marketInput = marketSchema.extend({
  pricing: z.object({ buyYesPriceUsd: integer.nullable() }).nullable(),
});
const buildInput = z.object({
  transaction: z.string().min(20).max(20000),
  txMeta: txMetaSchema,
  requiredSigners: z.array(address).optional(),
  executionModel: z.string().nullable().optional(),
  order: z.object({
    userPubkey: address,
    marketId: z.string(),
    isBuy: z.literal(true),
    isYes: z.literal(true),
    maxBuyPriceUsd: integer.nullable(),
    orderCostUsd: integer,
    estimatedTotalFeeUsd: integer,
    contractsMicro: integer,
  }),
});
try {
  const catalog = z
    .object({ data: z.array(z.object({ markets: z.array(marketInput) })) })
    .parse(
      await provider.request(
        "/events?category=crypto&filter=trending&includeMarkets=true&start=0&end=12",
      ),
    );
  const marketId =
    argument("--market") ??
    catalog.data
      .flatMap((event) => event.markets)
      .find(
        (m) =>
          m.status === "open" &&
          ["polymarket", "gx"].includes(m.provider) &&
          m.pricing?.buyYesPriceUsd != null &&
          m.closeTime * 1000 > Date.now(),
      )?.marketId;
  if (!marketId)
    throw Error("No supported open market available for the diagnostic.");
  stage = "market";
  const market = marketInput.parse(
    await provider.request("/markets/" + encodeURIComponent(marketId)),
  );
  const quoted = market.pricing?.buyYesPriceUsd;
  if (
    market.marketId !== marketId ||
    !["polymarket", "gx"].includes(market.provider) ||
    market.status !== "open" ||
    market.result !== null ||
    market.closeTime * 1000 <= Date.now() ||
    !quoted ||
    BigInt(quoted) <= 0n ||
    BigInt(quoted) >= 1000000n
  )
    throw Error(
      "Diagnostic requires a supported, open YES market with a usable quote.",
    );
  stage = "trading_status";
  const active = z
    .object({ trading_active: z.literal(true) })
    .safeParse(await provider.request("/trading-status"));
  if (!active.success)
    throw Error("Exchange is not open; no unsigned build requested.");
  if (publicWallet) {
    stage = "wallet_funds";
    const funds = await readWalletFunds(owner);
    walletCheck = {
      usdc:
        funds.balances.USDC === null
          ? "unknown"
          : BigInt(funds.balances.USDC) < 5000000n
            ? "below_minimum"
            : "minimum_met",
      sol:
        funds.solLamports === null
          ? "unknown"
          : BigInt(funds.solLamports) === 0n
            ? "zero"
            : "present",
    };
    if (funds.balances.USDC === null || funds.solLamports === null)
      throw Error(
        "Wallet funds could not be verified. No unsigned build requested.",
      );
    if (BigInt(funds.balances.USDC) < 5000000n)
      throw Error(
        "Spendable USDC is below the $5 diagnostic minimum. No unsigned build requested; total costs remain unverified.",
      );
    if (BigInt(funds.solLamports) === 0n)
      throw Error(
        "No SOL is available for network costs. No unsigned build requested; total costs remain unverified.",
      );
  }
  stage = "unsigned_build";
  const build = buildInput.parse(
    await provider.request("/orders", "POST", {
      ownerPubkey: owner,
      marketId,
      isYes: true,
      isBuy: true,
      depositAmount: "5000000",
      depositMint: USDC,
    }),
  );
  if (build.order.userPubkey !== owner || build.order.marketId !== marketId)
    throw Error("Unsigned build owner/market did not match the request.");
  const tx = VersionedTransaction.deserialize(
    Buffer.from(build.transaction, "base64"),
  );
  const signers = tx.message.staticAccountKeys
    .slice(0, tx.message.header.numRequiredSignatures)
    .map((k) => k.toBase58());
  const signatureAudit = auditBuildSignatures(tx, owner, build.requiredSigners);
  stage = "rpc_inspection";
  const connection = rpc();
  await assertMainnet(connection);
  const tables = await Promise.all(
    tx.message.addressTableLookups.map(async (lookup) => {
      const table = await connection.getAddressLookupTable(lookup.accountKey);
      if (!table.value) throw Error("Transaction lookup table unavailable.");
      return table.value;
    }),
  );
  const message = TransactionMessage.decompile(tx.message, {
    addressLookupTableAccounts: tables,
  });
  const fee = await connection.getFeeForMessage(tx.message, "confirmed");
  if (fee.value !== null && (!Number.isSafeInteger(fee.value) || fee.value < 0))
    throw Error("RPC fee is not an exact nonnegative amount.");
  const limit = (BigInt(quoted) * 10300n) / 10000n;
  const keys = tx.message.getAccountKeys({
    addressLookupTableAccounts: tables,
  });
  const writable = Array.from({ length: keys.length }, (_, i) => i)
    .filter((i) => tx.message.isAccountWritable(i))
    .map((i) => keys.get(i)!);
  if (writable.length > 100)
    throw Error("Too many writable accounts to inspect.");
  const before = await connection.getMultipleAccountsInfoAndContext(
    writable,
    "confirmed",
  );
  stage = "unsigned_simulation";
  const simulation = await connection.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: false,
    commitment: "confirmed",
    minContextSlot: before.context.slot,
    accounts: {
      encoding: "base64",
      addresses: writable.map((key) => key.toBase58()),
    },
  });
  const changes =
    simulation.value.err === null && simulation.value.accounts
      ? simulationBalanceChanges(
          writable.map((key) => key.toBase58()),
          before.value.map(
            (a) =>
              a && {
                owner: a.owner.toBase58(),
                data: a.data,
                lamports: a.lamports,
              },
          ),
          simulation.value.accounts.map(
            (a) =>
              a && {
                owner: a.owner,
                data: Buffer.from(a.data[0], "base64"),
                lamports: a.lamports,
              },
          ),
          owner,
          USDC,
        )
      : null;
  const evidence = {
    evidence: publicWallet
      ? "Unsigned $5 USDC YES build for a user-selected public address (omitted from capture)"
      : "Unsigned $5 USDC YES build for an ephemeral empty test address",
    capturedAt: new Date().toISOString(),
    marketId,
    provider: market.provider,
    testOwner: publicWallet ? "omitted" : owner,
    walletCheck,
    quotePrice: quoted,
    diagnosticPriceCeiling: limit.toString(),
    order: { ...build.order, userPubkey: publicWallet ? "omitted" : owner },
    transaction: {
      feePayerMatches: tx.message.staticAccountKeys[0]?.toBase58() === owner,
      ownerIsSigner: signers.includes(owner),
      requiredSignerCount: signers.length,
      declaredSignersMatch: build.requiredSigners
        ? build.requiredSigners.length === signers.length &&
          build.requiredSigners.every((s) => signers.includes(s))
        : null,
      blockhashMatches: tx.message.recentBlockhash === build.txMeta.blockhash,
      additionalSigners: signers.filter((s) => s !== owner),
      signatureAudit,
      programIds: [
        ...new Set(message.instructions.map((i) => i.programId.toBase58())),
      ],
      networkFeeLamports: fee.value === null ? null : String(fee.value),
    },
    returnedPriceWithinDiagnosticCeiling:
      build.order.maxBuyPriceUsd === null
        ? null
        : BigInt(build.order.maxBuyPriceUsd) <= limit,
    executionModel: build.executionModel ?? null,
    simulation: {
      performed: true,
      signatureVerification: false,
      blockhashReplaced: false,
      success: simulation.value.err === null,
      errorPresent: simulation.value.err !== null,
      unitsConsumed: simulation.value.unitsConsumed ?? null,
      beforeSlot: before.context.slot,
      simulationSlot: simulation.context.slot,
      sameSlot: before.context.slot === simulation.context.slot,
      balanceChanges: changes,
      debitWithinRequestedDeposit:
        changes?.tokenDelta == null ||
        before.context.slot !== simulation.context.slot
          ? null
          : BigInt(changes.tokenDelta) >= -5000000n &&
            BigInt(changes.tokenDelta) < 0n,
      costEvidence:
        "Simulation-only account changes; different slots may include unrelated changes. Not an enforced spending cap or complete future keeper costs.",
    },
    signingEnabled: false,
    approvalReadiness: {
      status: "blocked",
      instructionSemanticsVerified: false,
      enforcedPriceLimitVerified: false,
      reason:
        "Unsigned simulation is spending evidence, not instruction authorization. No wallet approval payload is exposed.",
    },
    unresolved: [
      "Instruction contents, deposit debit and signer roles need verification against the maintained program specification.",
      "No requested buy-price ceiling is documented; returned metadata does not prove enforcement in the transaction.",
      "Fees/rent, executable buy depth, balances and open-order reconciliation remain prerequisites.",
      "Unsigned simulation omits signature verification and does not prove execution or keeper fill; wallet approval, submission and fill tracking are untested.",
    ],
    unsignedBuildsRequested: 1,
    ordersSubmitted: 0,
    plansSaved: 0,
  };
  writeFileSync(
    "docs/research/agent-build-probe.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  const evidence = {
    evidence: "Unsigned buy diagnostic did not complete",
    capturedAt: new Date().toISOString(),
    stage,
    walletCheck,
    providerFailure: failure,
    unsignedBuildAttempted: [
      "unsigned_build",
      "rpc_inspection",
      "unsigned_simulation",
    ].includes(stage),
    signingEnabled: false,
    ordersSubmitted: 0,
    plansSaved: 0,
  };
  writeFileSync(
    "docs/research/agent-build-probe.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence, null, 2));
  let diagnosticMessage =
    error instanceof z.ZodError
      ? "Provider response did not match the diagnostic contract; no transaction was signed."
      : error instanceof Error
        ? error.message
        : "Unsigned build diagnostic failed.";
  for (const name of ["JUPITER_API_KEY", "SOLANA_RPC_URL"]) {
    const configured = process.env[name];
    if (configured)
      diagnosticMessage = diagnosticMessage.replaceAll(
        configured,
        "[redacted]",
      );
  }
  console.error(diagnosticMessage);
  process.exitCode = 1;
}
