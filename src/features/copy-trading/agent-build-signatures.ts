import type { VersionedTransaction } from "@solana/web3.js";
import nacl from "tweetnacl";

/** Diagnostic evidence only; this does not authorize any program or trade. */
export function auditBuildSignatures(
  tx: VersionedTransaction,
  owner: string,
  declared?: string[],
) {
  const message = tx.message.serialize();
  const signers = tx.message.staticAccountKeys.slice(
    0,
    tx.message.header.numRequiredSignatures,
  );
  const slots = signers.map((key, index) => {
    const signature = tx.signatures[index];
    const present = !!signature && signature.some((byte) => byte !== 0);
    return {
      key: key.toBase58(),
      owner: key.toBase58() === owner,
      present,
      valid: present
        ? nacl.sign.detached.verify(message, signature, key.toBytes())
        : null,
    };
  });
  const sameSet = (expected: string[]) =>
    declared === undefined
      ? null
      : new Set(declared).size === declared.length &&
        declared.length === expected.length &&
        expected.every((key) => declared.includes(key));
  const pending = slots.filter((slot) => !slot.present).map((slot) => slot.key);
  return {
    ownerIsSigner: slots.some((slot) => slot.owner),
    ownerSignaturePresent: slots.find((slot) => slot.owner)?.present ?? false,
    requiredSignerCount: slots.length,
    suppliedSignatureCount: slots.filter((slot) => slot.present).length,
    suppliedSignaturesValid: slots.every((slot) => !slot.present || slot.valid),
    pendingSignerCount: pending.length,
    ownerIsOnlyPendingSigner: pending.length === 1 && pending[0] === owner,
    declaredMatchesAllSigners: sameSet(slots.map((slot) => slot.key)),
    declaredMatchesPendingSigners: sameSet(pending),
    additionalSigners: slots
      .filter((slot) => !slot.owner)
      .map(({ key, present, valid }) => ({
        key,
        signaturePresent: present,
        signatureValid: valid,
      })),
  };
}
