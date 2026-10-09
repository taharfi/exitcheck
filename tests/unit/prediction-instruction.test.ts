import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  decodePredictionCreateOrder,
  PREDICTION_PROGRAM,
} from "../../src/features/copy-trading/prediction-instruction";

function instruction() {
  const string = (text: string) => {
    const bytes = Buffer.from(text),
      size = Buffer.alloc(4);
    size.writeUInt32LE(bytes.length);
    return Buffer.concat([size, bytes]);
  };
  const amounts = Buffer.alloc(24);
  amounts.writeBigUInt64LE(9007199254740993n);
  amounts.writeBigUInt64LE(880000n, 8);
  amounts.writeBigUInt64LE(5000000n, 16);
  const data = Buffer.concat([
    Buffer.from([141, 54, 37, 207, 237, 210, 250, 215]),
    string("sample-order"),
    string("market-hash"),
    Buffer.from([1, 1]),
    amounts,
    Buffer.from([0, 0, 0]),
  ]);
  return new TransactionInstruction({
    programId: new PublicKey(PREDICTION_PROGRAM),
    data,
    keys: Array.from({ length: 12 }, (_, index) => ({
      pubkey: Keypair.generate().publicKey,
      isSigner: index < 3,
      isWritable: index !== 1 && index !== 2,
    })),
  });
}
describe("prediction create-order decoding", () => {
  it("preserves exact amounts and independently decodes the cap, side and account roles", () => {
    const input = instruction(),
      result = decodePredictionCreateOrder(input);
    expect(result.contracts).toBe("9007199254740993");
    expect(result.maxFillPriceUsd).toBe("880000");
    expect(result.depositAmount).toBe("5000000");
    expect(result.isYes).toBe(true);
    expect(result.isBuy).toBe(true);
    expect(result.accounts.owner).toBe(input.keys[1].pubkey.toBase58());
    expect(result.accounts.authority).toBe(input.keys[2].pubkey.toBase58());
  });
  it("rejects another program and instruction discriminator", () => {
    const input = instruction();
    input.programId = Keypair.generate().publicKey;
    expect(() => decodePredictionCreateOrder(input)).toThrow("Unsupported");
    input.programId = new PublicKey(PREDICTION_PROGRAM);
    input.data[0] ^= 1;
    expect(() => decodePredictionCreateOrder(input)).toThrow("Unsupported");
  });
  it("rejects every truncated prefix", () => {
    const input = instruction(),
      data = input.data;
    for (let i = 0; i < data.length; i++) {
      input.data = data.subarray(0, i);
      expect(() => decodePredictionCreateOrder(input)).toThrow();
    }
  });
  it("rejects a non-boolean side and unknown optional tag", () => {
    const input = instruction();
    input.data[8 + 4 + 12 + 4 + 11] = 2;
    expect(() => decodePredictionCreateOrder(input)).toThrow("boolean");
    const second = instruction();
    second.data[second.data.length - 1] = 2;
    expect(() => decodePredictionCreateOrder(second)).toThrow("option");
  });
  it("rejects trailing bytes and extra account permissions", () => {
    const input = instruction();
    input.data = Buffer.concat([input.data, Buffer.from([0])]);
    expect(() => decodePredictionCreateOrder(input)).toThrow("trailing");
    const second = instruction();
    second.keys.push(second.keys[0]);
    expect(() => decodePredictionCreateOrder(second)).toThrow("account count");
  });
});
