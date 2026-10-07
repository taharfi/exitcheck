import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { simulationBalanceChanges } from "../../src/features/copy-trading/agent-simulation-balances";

const owner = Keypair.generate().publicKey.toBase58();
const mint = Keypair.generate().publicKey;
const address = Keypair.generate().publicKey.toBase58();
const token = (amount: bigint, wallet = owner) => {
  const data = Buffer.alloc(165);
  data.set(mint.toBytes());
  // Account authority is independent of its address.
  data.set(new PublicKey(wallet).toBytes(), 32);
  data.writeBigUInt64LE(amount, 64);
  return {
    owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    data,
    lamports: 2039280,
  };
};
describe("unsigned simulation balance evidence", () => {
  it("counts newly created and closed token accounts", () => {
    expect(
      simulationBalanceChanges(
        [address],
        [null],
        [token(7n)],
        owner,
        mint.toBase58(),
      ).tokenDelta,
    ).toBe("7");
    expect(
      simulationBalanceChanges(
        [address],
        [token(7n)],
        [null],
        owner,
        mint.toBase58(),
      ).tokenDelta,
    ).toBe("-7");
  });
  it("fails on unsupported token program or layouts", () => {
    expect(() =>
      simulationBalanceChanges(
        [address],
        [
          {
            ...token(7n),
            owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
          },
        ],
        [null],
        owner,
        mint.toBase58(),
      ),
    ).toThrow("unsupported");
    expect(() =>
      simulationBalanceChanges(
        [address],
        [{ ...token(7n), data: Buffer.alloc(164) }],
        [null],
        owner,
        mint.toBase58(),
      ),
    ).toThrow("layout");
  });
  it("does not round an unsafe native balance", () => {
    const account = {
      owner: "11111111111111111111111111111111",
      data: Buffer.alloc(0),
      lamports: Number.MAX_SAFE_INTEGER + 1,
    };
    expect(
      simulationBalanceChanges(
        [owner],
        [account],
        [account],
        owner,
        mint.toBase58(),
      ).ownerLamportDelta,
    ).toBeNull();
  });
  it("measures token debit exactly without granting approval", () => {
    const result = simulationBalanceChanges(
      [address],
      [token(9007199254740993n)],
      [token(9007199249740993n)],
      owner,
      mint.toBase58(),
    );
    expect(result.tokenDelta).toBe("-5000000");
    expect(result.authorizesSigning).toBe(false);
  });
  it("does not count another wallet's tokens", () => {
    const other = Keypair.generate().publicKey.toBase58();
    expect(
      simulationBalanceChanges(
        [address],
        [token(5000000n, other)],
        [token(0n, other)],
        owner,
        mint.toBase58(),
      ).tokenDelta,
    ).toBeNull();
  });
  it("rejects account authority replacement", () => {
    expect(() =>
      simulationBalanceChanges(
        [address],
        [token(5000000n)],
        [token(0n, Keypair.generate().publicKey.toBase58())],
        owner,
        mint.toBase58(),
      ),
    ).toThrow("identity changed");
  });
  it("reports SOL changes including simulated account funding", () => {
    const system = {
      owner: "11111111111111111111111111111111",
      data: Buffer.alloc(0),
      lamports: 10000000,
    };
    expect(
      simulationBalanceChanges(
        [owner],
        [system],
        [{ ...system, lamports: 6000000 }],
        owner,
        mint.toBase58(),
      ).ownerLamportDelta,
    ).toBe("-4000000");
  });
  it("rejects incomplete and duplicate snapshots", () => {
    expect(() =>
      simulationBalanceChanges([address], [], [], owner, mint.toBase58()),
    ).toThrow();
    expect(() =>
      simulationBalanceChanges(
        [address, address],
        [null, null],
        [null, null],
        owner,
        mint.toBase58(),
      ),
    ).toThrow();
  });
});
