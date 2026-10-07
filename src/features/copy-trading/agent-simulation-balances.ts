import { PublicKey } from "@solana/web3.js";

type Snapshot = { owner: string; data: Uint8Array; lamports: number } | null;
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/** Diagnostic deltas only: snapshots may come from different slots. Never authorizes signing. */
export function simulationBalanceChanges(
  addresses: string[],
  before: Snapshot[],
  after: Snapshot[],
  owner: string,
  mint: string,
) {
  if (
    addresses.length !== before.length ||
    before.length !== after.length ||
    new Set(addresses).size !== addresses.length
  )
    throw Error("Incomplete account snapshots.");
  const token = (account: Snapshot) => {
    if (account?.owner === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
      throw Error("Extended token program simulation is unsupported.");
    if (!account || account.owner !== TOKEN) return null;
    // Extended accounts are unsupported until their semantics are verified.
    if (account.data.length !== 165)
      throw Error("Unsupported token account layout.");
    const data = Buffer.from(account.data);
    return {
      mint: new PublicKey(data.subarray(0, 32)).toBase58(),
      owner: new PublicKey(data.subarray(32, 64)).toBase58(),
      amount: data.readBigUInt64LE(64),
    };
  };
  let delta = 0n,
    inspected = 0;
  for (let i = 0; i < addresses.length; i++) {
    const a = token(before[i]),
      b = token(after[i]);
    const belongs = (value: ReturnType<typeof token>) =>
      value?.owner === owner && value.mint === mint;
    if (!belongs(a) && !belongs(b)) continue;
    if (a && b && (a.owner !== b.owner || a.mint !== b.mint))
      throw Error("Token identity changed.");
    if ((!a && before[i]) || (!b && after[i]))
      throw Error("Token layout changed.");
    inspected++;
    delta += (b?.amount ?? 0n) - (a?.amount ?? 0n);
  }
  const index = addresses.indexOf(owner),
    a = before[index],
    b = after[index];
  const exact = (n: number) => Number.isSafeInteger(n) && n >= 0;
  const solDelta =
    a && b && exact(a.lamports) && exact(b.lamports)
      ? (BigInt(b.lamports) - BigInt(a.lamports)).toString()
      : null;
  return {
    tokenAccountCount: inspected,
    tokenDelta: inspected ? delta.toString() : null,
    ownerLamportDelta: solDelta,
    authorizesSigning: false as const,
  };
}
