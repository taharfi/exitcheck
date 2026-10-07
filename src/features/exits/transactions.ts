import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
} from "@solana/web3.js";
import { AppError } from "../../lib/errors";
export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const JUPUSD = "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD";
export function rpc() {
  if (!process.env.SOLANA_RPC_URL)
    throw new AppError(
      "RPC_REQUIRED",
      "Configure SOLANA_RPC_URL for transaction simulation and tracking.",
      503,
    );
  return new Connection(process.env.SOLANA_RPC_URL, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    confirmTransactionInitialTimeout: 20000,
    fetch: (url, options) =>
      fetch(url, { ...options, signal: AbortSignal.timeout(10_000) }),
  });
}
const GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export async function assertMainnet(connection: Connection) {
  if ((await connection.getGenesisHash()) !== GENESIS)
    throw new AppError(
      "WRONG_NETWORK",
      "RPC must be connected to Solana mainnet-beta.",
      422,
    );
}
export async function inspectTransaction(
  encoded: string,
  owner: string,
  blockhash: string,
) {
  const connection = rpc();
  await assertMainnet(connection);
  const tx = VersionedTransaction.deserialize(Buffer.from(encoded, "base64"));
  const signers = tx.message.staticAccountKeys
    .slice(0, tx.message.header.numRequiredSignatures)
    .map((k) => k.toBase58());
  if (
    signers.length !== 1 ||
    signers[0] !== owner ||
    tx.message.staticAccountKeys[0].toBase58() !== owner
  )
    throw new AppError(
      "WRONG_SIGNER",
      "Transaction signer or fee payer does not match the position owner.",
      422,
    );
  if (tx.message.recentBlockhash !== blockhash)
    throw new AppError(
      "BLOCKHASH_MISMATCH",
      "Provider transaction metadata does not match the transaction.",
      422,
    );
  const tables = await Promise.all(
    tx.message.addressTableLookups.map(async (lookup) => {
      const result = await connection.getAddressLookupTable(lookup.accountKey);
      if (!result.value)
        throw new AppError(
          "LOOKUP_TABLE",
          "A transaction address table could not be resolved.",
          422,
        );
      return result.value;
    }),
  );
  const message = TransactionMessage.decompile(tx.message, {
    addressLookupTableAccounts: tables,
  });
  const programs = [
    ...new Set(message.instructions.map((i) => i.programId.toBase58())),
  ];
  const accounts = [
    ...new Set(
      message.instructions.flatMap((i) =>
        i.keys.map((k) => k.pubkey.toBase58()),
      ),
    ),
  ];
  const allowed = (process.env.ALLOWED_PROGRAM_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const approved = programs.every((p) => allowed.includes(p));
  const fee = await connection.getFeeForMessage(tx.message, "confirmed");
  if (fee.value === null)
    throw new AppError(
      "EXPIRED_TRANSACTION",
      "Transaction fee could not be determined. Refresh and prepare again.",
      422,
    );
  if (!Number.isSafeInteger(fee.value) || fee.value < 0)
    throw new AppError(
      "INVALID_RPC_AMOUNT",
      "RPC network fee could not be represented exactly.",
      502,
    );
  const balance = await connection.getBalance(
    new PublicKey(owner),
    "confirmed",
  );
  if (!Number.isSafeInteger(balance) || balance < 0)
    throw new AppError(
      "INVALID_RPC_AMOUNT",
      "RPC SOL balance could not be represented exactly.",
      502,
    );
  if (balance < fee.value)
    throw new AppError(
      "INSUFFICIENT_SOL",
      "The owner needs SOL for the network fee.",
      422,
    );
  const sim = await connection.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: false,
    commitment: "confirmed",
  });
  if (sim.value.err)
    throw new AppError(
      "SIMULATION_FAILED",
      "Transaction simulation failed. No signature was requested.",
      422,
    );
  return {
    programs,
    accounts,
    networkFee: String(fee.value),
    simulation: "Passed; future keeper fills are not guaranteed.",
    signingEnabled: approved && process.env.ENABLE_LIVE_EXECUTION === "true",
  };
}
export async function receivedForSignatures(
  signatures: string[],
  owner: string,
  relatedAccount: string,
): Promise<{ amount: string; asset: string } | null> {
  const connection = rpc();
  await assertMainnet(connection);
  let total = 0n;
  const mints = new Set<string>();
  for (const signature of [...new Set(signatures)]) {
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx?.meta || tx.meta.err) return null;
    const keys = tx.transaction.message.getAccountKeys(
      tx.meta.loadedAddresses
        ? { accountKeysFromLookups: tx.meta.loadedAddresses }
        : undefined,
    );
    const associated = Array.from({ length: keys.length }, (_, i) =>
      keys.get(i)?.toBase58(),
    ).includes(relatedAccount);
    if (!associated) return null;
    // Reject batched calls to the program that touches this order/position;
    // otherwise wallet deltas could include another payout. Fee receivers are
    // not incorrectly treated as another user's order.
    const accountIndex = Array.from({ length: keys.length }, (_, i) =>
      keys.get(i)?.toBase58(),
    ).indexOf(relatedAccount);
    const instructions = tx.transaction.message.compiledInstructions;
    const relatedPrograms = new Set(
      instructions
        .filter((i) => i.accountKeyIndexes.includes(accountIndex))
        .map((i) => i.programIdIndex),
    );
    if (
      relatedPrograms.size === 0 ||
      [...relatedPrograms].some(
        (program) =>
          instructions.filter((i) => i.programIdIndex === program).length !== 1,
      )
    )
      return null;
    if (
      [
        ...(tx.meta.preTokenBalances ?? []),
        ...(tx.meta.postTokenBalances ?? []),
      ].some(
        (b) =>
          [USDC, JUPUSD].includes(b.mint) && b.uiTokenAmount.decimals !== 6,
      )
    )
      return null;
    let delta = 0n;
    for (const mint of [USDC, JUPUSD]) {
      const sum = (
        balances: NonNullable<typeof tx.meta>["postTokenBalances"],
      ) =>
        (balances ?? [])
          .filter((b) => b.owner === owner && b.mint === mint)
          .reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
      const change =
        sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances);
      if (change > 0n) {
        delta += change;
        mints.add(mint);
      }
    }
    if (delta <= 0n) return null;
    total += delta;
  }
  if (mints.size !== 1 || signatures.length === 0) return null;
  return {
    amount: total.toString(),
    asset: mints.has(USDC) ? "USDC" : "JupUSD",
  };
}
