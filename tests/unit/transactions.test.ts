import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Connection,
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  inspectTransaction,
  receivedForSignatures,
  USDC,
} from "../../src/features/exits/transactions";
const owner = Keypair.generate(),
  recipient = Keypair.generate(),
  blockhash = Keypair.generate().publicKey.toBase58();
const makeTx = () =>
  new VersionedTransaction(
    new TransactionMessage({
      payerKey: owner.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: recipient.publicKey,
          lamports: 1,
        }),
      ],
    }).compileToV0Message(),
  );
const encode = () => Buffer.from(makeTx().serialize()).toString("base64");
beforeEach(() => {
  vi.stubEnv("SOLANA_RPC_URL", "https://fixture.invalid");
  vi.stubEnv("ENABLE_LIVE_EXECUTION", "true");
  vi.stubEnv("ALLOWED_PROGRAM_IDS", SystemProgram.programId.toBase58());
  vi.spyOn(Connection.prototype, "getGenesisHash").mockResolvedValue(
    "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  );
  vi.spyOn(Connection.prototype, "getFeeForMessage").mockResolvedValue({
    context: { slot: 1 },
    value: 5000,
  });
  vi.spyOn(Connection.prototype, "getBalance").mockResolvedValue(10000000);
  vi.spyOn(Connection.prototype, "simulateTransaction").mockResolvedValue({
    context: { slot: 1 },
    value: { err: null, logs: [] },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe("transaction inspection with synthetic transactions and mocked RPC (no live evidence)", () => {
  it("inspects signer, fee payer, programs, blockhash and simulation", async () => {
    const result = await inspectTransaction(
      encode(),
      owner.publicKey.toBase58(),
      blockhash,
    );
    expect(result.programs).toEqual([SystemProgram.programId.toBase58()]);
    expect(result.networkFee).toBe("5000");
    expect(result.signingEnabled).toBe(true);
  });
  it("blocks a different owning wallet", async () => {
    await expect(
      inspectTransaction(encode(), recipient.publicKey.toBase58(), blockhash),
    ).rejects.toMatchObject({ code: "WRONG_SIGNER" });
  });
  it("blocks inconsistent transaction metadata", async () => {
    await expect(
      inspectTransaction(
        encode(),
        owner.publicKey.toBase58(),
        recipient.publicKey.toBase58(),
      ),
    ).rejects.toMatchObject({ code: "BLOCKHASH_MISMATCH" });
  });
  it("unknown programs prevent signing even if simulation passed", async () => {
    vi.stubEnv("ALLOWED_PROGRAM_IDS", "");
    expect(
      (
        await inspectTransaction(
          encode(),
          owner.publicKey.toBase58(),
          blockhash,
        )
      ).signingEnabled,
    ).toBe(false);
  });
  it("blocks the wrong network", async () => {
    vi.mocked(Connection.prototype.getGenesisHash).mockResolvedValue(
      "fixture-devnet",
    );
    await expect(
      inspectTransaction(encode(), owner.publicKey.toBase58(), blockhash),
    ).rejects.toMatchObject({ code: "WRONG_NETWORK" });
  });
  it("blocks an account/simulation error", async () => {
    vi.mocked(Connection.prototype.simulateTransaction).mockResolvedValue({
      context: { slot: 1 },
      value: { err: { InstructionError: [0, "InsufficientFunds"] }, logs: [] },
    });
    await expect(
      inspectTransaction(encode(), owner.publicKey.toBase58(), blockhash),
    ).rejects.toMatchObject({ code: "SIMULATION_FAILED" });
  });
  it("requires SOL for fees", async () => {
    vi.mocked(Connection.prototype.getBalance).mockResolvedValue(0);
    await expect(
      inspectTransaction(encode(), owner.publicKey.toBase58(), blockhash),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_SOL" });
  });
  it("rejects an unsafe integer RPC fee instead of rounding it", async () => {
    vi.mocked(Connection.prototype.getFeeForMessage).mockResolvedValue({
      context: { slot: 1 },
      value: 9007199254740992,
    });
    await expect(
      inspectTransaction(encode(), owner.publicKey.toBase58(), blockhash),
    ).rejects.toMatchObject({ code: "INVALID_RPC_AMOUNT" });
  });
  it("verifies associated confirmed wallet credits and deduplicates signatures", async () => {
    const get = vi
      .spyOn(Connection.prototype, "getTransaction")
      .mockResolvedValue({
        slot: 1,
        transaction: { message: makeTx().message, signatures: [] },
        meta: {
          err: null,
          fee: 5000,
          preBalances: [],
          postBalances: [],
          preTokenBalances: [],
          postTokenBalances: [
            {
              accountIndex: 1,
              owner: owner.publicKey.toBase58(),
              mint: USDC,
              uiTokenAmount: {
                amount: "1234567",
                decimals: 6,
                uiAmount: 1.234567,
                uiAmountString: "1.234567",
              },
            },
          ],
        },
      });
    expect(
      await receivedForSignatures(
        ["fixture-signature", "fixture-signature"],
        owner.publicKey.toBase58(),
        recipient.publicKey.toBase58(),
      ),
    ).toEqual({ amount: "1234567", asset: "USDC" });
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("does not attribute a payout from an unrelated transaction", async () => {
    vi.spyOn(Connection.prototype, "getTransaction").mockResolvedValue({
      slot: 1,
      transaction: { message: makeTx().message, signatures: [] },
      meta: {
        err: null,
        fee: 5000,
        preBalances: [],
        postBalances: [],
        preTokenBalances: [],
        postTokenBalances: [
          {
            accountIndex: 1,
            owner: owner.publicKey.toBase58(),
            mint: USDC,
            uiTokenAmount: {
              amount: "1000000",
              decimals: 6,
              uiAmount: 1,
              uiAmountString: "1",
            },
          },
        ],
      },
    });
    expect(
      await receivedForSignatures(
        ["fixture-signature"],
        owner.publicKey.toBase58(),
        Keypair.generate().publicKey.toBase58(),
      ),
    ).toBeNull();
  });
});
