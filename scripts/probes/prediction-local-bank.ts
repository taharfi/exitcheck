import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  PublicKey,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  decodePredictionCreateOrder,
  PREDICTION_PROGRAM,
} from "../../src/features/copy-trading/prediction-instruction";

// Private local research snapshot. Never writes credentials or a signed transaction.
export async function exportLocalBank(
  connection: Connection,
  instruction: TransactionInstruction,
  writable: PublicKey[],
  post: ({
    owner: string;
    data: string[];
    lamports: number;
    executable: boolean;
  } | null)[],
  slot: number,
  authority: PublicKey,
  secondary: PublicKey,
) {
  const order = decodePredictionCreateOrder(instruction);
  const a = order.accounts;
  const [vaultAta] = PublicKey.findProgramAddressSync(
    [
      new PublicKey(a.vault).toBuffer(),
      new PublicKey(a.tokenProgram).toBuffer(),
      new PublicKey(a.settlementMint).toBuffer(),
    ],
    new PublicKey(a.associatedTokenProgram),
  );
  const addresses = [
    authority,
    secondary,
    vaultAta,
    ...instruction.keys.map((k) => k.pubkey),
  ];
  const unique = [...new Map(addresses.map((k) => [k.toBase58(), k])).values()];
  const live = await connection.getMultipleAccountsInfo(unique, "confirmed");
  const accounts = new Map(
    unique.flatMap((key, i) => {
      const account = live[i];
      return account
        ? [
            [
              key.toBase58(),
              {
                owner: account.owner.toBase58(),
                data: account.data.toString("base64"),
                lamports: account.lamports,
                executable: account.executable,
              },
            ] as const,
          ]
        : [];
    }),
  );
  if (post.length !== writable.length)
    throw Error("Incomplete simulation snapshot.");
  post.forEach((account, i) => {
    if (account && (account.data.length !== 2 || account.data[1] !== "base64"))
      throw Error("Unsupported snapshot encoding.");
    if (account)
      accounts.set(writable[i].toBase58(), {
        ...account,
        data: account.data[0],
      });
  });
  for (const account of accounts.values()) {
    if (!Number.isSafeInteger(account.lamports) || account.lamports < 0)
      throw Error("Inexact account lamports.");
  }
  const program = await connection.getAccountInfo(
    new PublicKey(PREDICTION_PROGRAM),
    "confirmed",
  );
  const loader = "BPFLoaderUpgradeab1e11111111111111111111111";
  if (
    !program?.executable ||
    program.owner.toBase58() !== loader ||
    program.data.length !== 36 ||
    program.data.readUInt32LE(0) !== 2
  )
    throw Error("Unsupported deployed program layout.");
  const programData = await connection.getAccountInfo(
    new PublicKey(program.data.subarray(4)),
    "confirmed",
  );
  if (
    !programData ||
    programData.owner.toBase58() !== loader ||
    programData.data.length < 45 ||
    programData.data.readUInt32LE(0) !== 3
  )
    throw Error("Unsupported program-data layout.");
  const elf = programData.data.subarray(45);
  if (!elf.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])))
    throw Error("Missing ELF program.");
  mkdirSync("data/prediction-local-bank", { recursive: true });
  writeFileSync("data/prediction-local-bank/program.so", elf);
  writeFileSync(
    "data/prediction-local-bank/bank.json",
    JSON.stringify(
      {
        model: "copied_post_create_state_separate_keeper_fill",
        slot,
        capturedAt: new Date().toISOString(),
        program: PREDICTION_PROGRAM,
        programSha256: createHash("sha256").update(elf).digest("hex"),
        order,
        authority: authority.toBase58(),
        secondary: secondary.toBase58(),
        vaultAta: vaultAta.toBase58(),
        accounts: Object.fromEntries(accounts),
        limitations:
          "RPC copies can be from different slots; local runtime is not mainnet execution.",
      },
      null,
      2,
    ),
  );
}
