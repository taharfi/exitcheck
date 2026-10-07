import { expect, it } from "vitest";
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { auditBuildSignatures } from "../../src/features/copy-trading/agent-build-signatures";
function fixture() {
  const owner = Keypair.generate(),
    auxiliary = Keypair.generate();
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: owner.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [
        SystemProgram.createAccount({
          fromPubkey: owner.publicKey,
          newAccountPubkey: auxiliary.publicKey,
          lamports: 1,
          space: 0,
          programId: SystemProgram.programId,
        }),
      ],
    }).compileToV0Message(),
  );
  return { owner, auxiliary, tx };
}
it("distinguishes a valid existing auxiliary signature from pending owner approval", () => {
  const { owner, auxiliary, tx } = fixture();
  tx.sign([auxiliary]);
  const result = auditBuildSignatures(tx, owner.publicKey.toBase58(), [
    owner.publicKey.toBase58(),
  ]);
  expect(result.suppliedSignaturesValid).toBe(true);
  expect(result.ownerIsOnlyPendingSigner).toBe(true);
  expect(result.ownerSignaturePresent).toBe(false);
  expect(result.declaredMatchesAllSigners).toBe(false);
  expect(result.declaredMatchesPendingSigners).toBe(true);
});
it("detects a supplied signature that no longer matches the message", () => {
  const { owner, auxiliary, tx } = fixture();
  tx.sign([auxiliary]);
  tx.message.recentBlockhash = Keypair.generate().publicKey.toBase58();
  expect(
    auditBuildSignatures(tx, owner.publicKey.toBase58())
      .suppliedSignaturesValid,
  ).toBe(false);
});
it("does not treat another missing signer as wallet-only approval", () => {
  const { owner, tx } = fixture();
  const result = auditBuildSignatures(tx, owner.publicKey.toBase58(), [
    owner.publicKey.toBase58(),
  ]);
  expect(result.ownerIsOnlyPendingSigner).toBe(false);
  expect(result.declaredMatchesPendingSigners).toBe(false);
});
it("rejects duplicate signer declarations and does not infer absent metadata", () => {
  const { owner, auxiliary, tx } = fixture();
  tx.sign([auxiliary]);
  const wallet = owner.publicKey.toBase58();
  expect(
    auditBuildSignatures(tx, wallet, [wallet, wallet])
      .declaredMatchesPendingSigners,
  ).toBe(false);
  expect(
    auditBuildSignatures(tx, wallet).declaredMatchesPendingSigners,
  ).toBeNull();
});
