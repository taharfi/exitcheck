import { PublicKey, type TransactionInstruction } from "@solana/web3.js";

export const PREDICTION_PROGRAM =
  "3ZZuTbwC6aJbvteyVxXUS7gtFYdf7AuXeitx6VyvjvUp";
// create_order / CreateOrderParams from the program-owned mainnet IDL v0.10.0.
// Schema evidence only: decoding does not authorize a transaction or prove keeper behavior.
const CREATE_ORDER = Buffer.from([141, 54, 37, 207, 237, 210, 250, 215]);
export function decodePredictionCreateOrder(
  instruction: TransactionInstruction,
) {
  if (
    instruction.programId.toBase58() !== PREDICTION_PROGRAM ||
    !instruction.data.subarray(0, 8).equals(CREATE_ORDER)
  )
    throw Error("Unsupported prediction instruction.");
  const data = instruction.data;
  let offset = 8;
  const take = (length: number) => {
    if (length < 0 || offset + length > data.length)
      throw Error("Truncated order instruction.");
    const value = data.subarray(offset, offset + length);
    offset += length;
    return value;
  };
  const byte = () => take(1)[0];
  const boolean = () => {
    const n = byte();
    if (n > 1) throw Error("Invalid order boolean.");
    return n === 1;
  };
  const option = <T>(read: () => T) => {
    const n = byte();
    if (n > 1) throw Error("Invalid order option.");
    return n ? read() : null;
  };
  const string = () => {
    const length = take(4).readUInt32LE();
    if (length > 256) throw Error("Order identifier exceeds limit.");
    return new TextDecoder("utf-8", { fatal: true }).decode(take(length));
  };
  const u64 = () => take(8).readBigUInt64LE().toString();
  const externalOrderId = string(),
    marketId = string();
  const isYes = boolean(),
    isBuy = boolean();
  const contracts = u64(),
    maxFillPriceUsd = u64(),
    depositAmount = u64();
  const orderType = byte();
  if (orderType > 1) throw Error("Unsupported order type.");
  const integrator = option(() => new PublicKey(take(32)).toBase58());
  const integratorFeeBps = option(() => take(2).readUInt16LE());
  if (offset !== data.length) throw Error("Unexpected trailing order data.");
  const names = [
    "payer",
    "owner",
    "authority",
    "vault",
    "position",
    "order",
    "ownerTokenAccount",
    "settlementMint",
    "orderAta",
    "tokenProgram",
    "associatedTokenProgram",
    "systemProgram",
  ] as const;
  if (instruction.keys.length !== names.length)
    throw Error("Unexpected order account count.");
  const accounts = Object.fromEntries(
    names.map((name, index) => [
      name,
      instruction.keys[index].pubkey.toBase58(),
    ]),
  ) as Record<(typeof names)[number], string>;
  return {
    externalOrderId,
    marketId,
    isYes,
    isBuy,
    contracts,
    maxFillPriceUsd,
    depositAmount,
    orderType: orderType === 0 ? "market" : "limit",
    integrator,
    integratorFeeBps,
    accounts,
  };
}
