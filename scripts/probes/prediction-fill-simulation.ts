import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  type AddressLookupTableAccount,
} from "@solana/web3.js";
import {
  PREDICTION_PROGRAM,
  decodePredictionCreateOrder,
} from "../../src/features/copy-trading/prediction-instruction";
import { readFileSync, writeFileSync } from "node:fs";
import { assertMainnet } from "../../src/features/exits/transactions";
import { z } from "zod";
const FILL = Buffer.from([179, 201, 221, 22, 91, 16, 208, 4]);
const referenceSchema = z.object({
  at: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  authority: z.string().max(44),
  secondary: z.string().max(44),
  tables: z.array(z.string().max(44)).max(32),
});
// Read public confirmed account roles. Never obtains keys capable of signing.
export async function findFillAuthorities(connection: Connection) {
  await assertMainnet(connection);
  const cachePath = "docs/research/prediction-fill-reference.json";
  try {
    const cachedText = readFileSync(cachePath, "utf8");
    if (cachedText.length > 8192) throw Error("Reference cache exceeds limit.");
    const cache = referenceSchema.parse(JSON.parse(cachedText));
    if (
      Number.isSafeInteger(cache.at) &&
      cache.at <= Date.now() &&
      Date.now() - cache.at < 900000 &&
      Array.isArray(cache.tables) &&
      cache.tables.length <= 32
    ) {
      const lookups = await Promise.all(
        cache.tables.map((key: string) =>
          connection.getAddressLookupTable(new PublicKey(key)),
        ),
      );
      return {
        authority: new PublicKey(cache.authority),
        secondary: new PublicKey(cache.secondary),
        tables: lookups.flatMap((l) => (l.value ? [l.value] : [])),
      };
    }
  } catch {
    /* Cache unavailable; read confirmed public instructions. */
  }
  const signatures = await connection.getSignaturesForAddress(
    new PublicKey(PREDICTION_PROGRAM),
    { limit: 20 },
    "confirmed",
  );
  for (const item of signatures) {
    if (item.err) continue;
    await new Promise((resolve) => setTimeout(resolve, 400));
    const tx = await connection.getTransaction(item.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx || tx.meta?.err) continue;
    const keys = tx.transaction.message.getAccountKeys(
      tx.meta?.loadedAddresses
        ? { accountKeysFromLookups: tx.meta.loadedAddresses }
        : undefined,
    );
    const fill = tx.transaction.message.compiledInstructions.find(
      (i) =>
        keys.get(i.programIdIndex)?.toBase58() === PREDICTION_PROGRAM &&
        Buffer.from(i.data).subarray(0, 8).equals(FILL),
    );
    if (fill && fill.accountKeyIndexes.length >= 2) {
      const lookups = await Promise.all(
        tx.transaction.message.addressTableLookups.map((l) =>
          connection.getAddressLookupTable(l.accountKey),
        ),
      );
      writeFileSync(
        cachePath,
        JSON.stringify({
          at: Date.now(),
          authority: keys.get(fill.accountKeyIndexes[0])!.toBase58(),
          secondary: keys.get(fill.accountKeyIndexes[1])!.toBase58(),
          tables: tx.transaction.message.addressTableLookups.map((l) =>
            l.accountKey.toBase58(),
          ),
        }) + "\n",
      );
      return {
        authority: keys.get(fill.accountKeyIndexes[0])!,
        secondary: keys.get(fill.accountKeyIndexes[1])!,
        tables: lookups.flatMap((l) => (l.value ? [l.value] : [])),
      };
    }
  }
  throw Error(
    "No public confirmed buy-fill reference available for unsigned control simulation.",
  );
}
export async function simulateFillPriceBoundary(
  connection: Connection,
  message: TransactionMessage,
  authorities: Awaited<ReturnType<typeof findFillAuthorities>>,
  tables: AddressLookupTableAccount[],
) {
  const instruction = message.instructions.find(
    (i) => i.programId.toBase58() === PREDICTION_PROGRAM,
  );
  if (!instruction) throw Error("No order creation instruction.");
  const order = decodePredictionCreateOrder(instruction),
    accounts = order.accounts;
  const pub = (value: string) => new PublicKey(value);
  const [vaultAta] = PublicKey.findProgramAddressSync(
    [
      pub(accounts.vault).toBuffer(),
      pub(accounts.tokenProgram).toBuffer(),
      pub(accounts.settlementMint).toBuffer(),
    ],
    pub(accounts.associatedTokenProgram),
  );
  const keys = [
    { pubkey: authorities.authority, isSigner: true, isWritable: true },
    { pubkey: authorities.secondary, isSigner: true, isWritable: true },
    ...[
      accounts.owner,
      accounts.vault,
      accounts.position,
      accounts.order,
      vaultAta.toBase58(),
      accounts.orderAta,
    ].map((key) => ({ pubkey: pub(key), isSigner: false, isWritable: true })),
    { pubkey: pub(PREDICTION_PROGRAM), isSigner: false, isWritable: false },
    { pubkey: pub(accounts.tokenProgram), isSigner: false, isWritable: false },
  ];
  const contracts = BigInt(order.contracts),
    cap = BigInt(order.maxFillPriceUsd);
  if (contracts <= 0n || cap <= 0n || cap >= 990000n)
    throw Error("Unsupported price-boundary diagnostic amounts.");
  const run = async (price: bigint) => {
    const cost = (contracts * price + 999999n) / 1000000n;
    const identifier = Buffer.from(order.externalOrderId, "utf8");
    const data = Buffer.alloc(37 + identifier.length);
    FILL.copy(data);
    data.writeBigUInt64LE(contracts, 8);
    data.writeBigUInt64LE(cost, 16);
    data.writeBigUInt64LE(0n, 24);
    data[32] = 1;
    data.writeUInt32LE(identifier.length, 33);
    identifier.copy(data, 37);
    const fill = new TransactionInstruction({
      programId: pub(PREDICTION_PROGRAM),
      keys,
      data,
    });
    // Synthetic messages deliberately have no signatures; program logic test only.
    const combinedTables = [
      ...new Map(
        [...tables, ...authorities.tables].map((t) => [t.key.toBase58(), t]),
      ).values(),
    ];
    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: message.payerKey,
        recentBlockhash: message.recentBlockhash,
        instructions: [...message.instructions, fill],
      }).compileToV0Message(combinedTables),
    );
    const result = await connection.simulateTransaction(tx, {
      sigVerify: false,
      replaceRecentBlockhash: false,
      commitment: "confirmed",
    });
    const error = result.value.err;
    const custom =
      error &&
      typeof error === "object" &&
      "InstructionError" in error &&
      Array.isArray(error.InstructionError)
        ? error.InstructionError[1]
        : null;
    return {
      success: error === null,
      customCode:
        custom && typeof custom === "object" && "Custom" in custom
          ? custom.Custom
          : null,
      unitsConsumed: result.value.unitsConsumed ?? null,
      errorDetail:
        result.value.logs?.find((l) =>
          /AnchorError|Error Code:|Error Number:/.test(l),
        ) ?? null,
    };
  };
  const [withinLimit, aboveLimit] = await Promise.all([
    run(cap - 10000n),
    run(cap + 10000n),
  ]);
  return {
    model: "combined_create_and_fill_owner_is_signer",
    representativeKeeperFill: false,
    withinLimit,
    aboveLimit,
    rejectsAboveLimit: null,
    observedAboveLimitRejection:
      withinLimit.success &&
      !aboveLimit.success &&
      aboveLimit.customCode === 6053,
    createAndFillAuthorityMatch:
      accounts.authority === authorities.authority.toBase58(),
    signatureVerification: false,
    ordersSubmitted: 0,
  };
}
