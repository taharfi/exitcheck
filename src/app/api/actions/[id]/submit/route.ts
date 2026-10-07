import { z } from "zod";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { VersionedTransaction } from "@solana/web3.js";
import { endpoint, body } from "@/lib/http";
import { getAction, lockSubmission, saveAction } from "@/features/exits/store";
import {
  rpc,
  assertMainnet,
  inspectTransaction,
} from "@/features/exits/transactions";
import { preview } from "@/features/exits/service";
import { AppError } from "@/lib/errors";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return endpoint(request, async () => {
    const input = z
      .object({
        token: z.string().regex(/^[a-f0-9]{64}$/),
        signedTransaction: z.string().max(20000),
      })
      .parse(await body(request));
    const action = await getAction(
      z.uuid().parse((await params).id),
      input.token,
    );
    if (!action.signingEnabled || process.env.ENABLE_LIVE_EXECUTION !== "true")
      throw new AppError(
        "EXECUTION_DISABLED",
        "Live signing is not enabled for this reviewed action.",
        403,
      );
    if (action.status !== "prepared" || action.expiresAt < Date.now())
      throw new AppError(
        "STALE_ACTION",
        "Action expired or has already been submitted. Reconcile before continuing.",
        409,
      );
    const prepared = VersionedTransaction.deserialize(
      Buffer.from(action.transaction, "base64"),
    );
    const signed = VersionedTransaction.deserialize(
      Buffer.from(input.signedTransaction, "base64"),
    );
    if (
      !Buffer.from(prepared.message.serialize()).equals(
        Buffer.from(signed.message.serialize()),
      )
    )
      throw new AppError(
        "TRANSACTION_CHANGED",
        "The signed transaction differs from the reviewed transaction.",
        422,
      );
    if (
      !nacl.sign.detached.verify(
        signed.message.serialize(),
        signed.signatures[0],
        signed.message.staticAccountKeys[0].toBytes(),
      )
    )
      throw new AppError(
        "INVALID_SIGNATURE",
        "Wallet signature could not be verified.",
        422,
      );
    const fresh = await preview(
      action.owner,
      action.positionId,
      action.quantity,
    );
    if (
      action.kind === "sell" &&
      (fresh.position.state !== "open" ||
        !fresh.tradingActive ||
        fresh.estimate?.insufficient)
    )
      throw new AppError(
        "EXIT_UNAVAILABLE",
        "Trading conditions changed. This action will not be submitted.",
        422,
      );
    if (action.kind === "claim" && fresh.position.state !== "claimable")
      throw new AppError(
        "CLAIM_UNAVAILABLE",
        "Claim eligibility changed.",
        422,
      );
    const inspected = await inspectTransaction(
      action.transaction,
      action.owner,
      action.blockhash,
    );
    if (!inspected.signingEnabled)
      throw new AppError(
        "PROGRAM_NOT_APPROVED",
        "Transaction programs are not approved for execution.",
        403,
      );
    const connection = rpc();
    await assertMainnet(connection);
    if (
      (await connection.getBlockHeight("confirmed")) >
      action.lastValidBlockHeight
    )
      throw new AppError(
        "EXPIRED_TRANSACTION",
        "Transaction blockhash expired.",
        422,
      );
    if (!(await lockSubmission(action.id)))
      throw new AppError(
        "DUPLICATE_SUBMISSION",
        "Action submission already started. Reconcile it.",
        409,
      );
    // Persist the signature before networking, allowing recovery from ambiguous timeouts.
    action.signature = bs58.encode(signed.signatures[0]);
    action.status = "submitting";
    action.updatedAt = Date.now();
    await saveAction(action);
    try {
      const signature = await connection.sendRawTransaction(
        signed.serialize(),
        {
          skipPreflight: false,
          maxRetries: 0,
          preflightCommitment: "confirmed",
        },
      );
      if (signature !== action.signature) throw new Error("Signature mismatch");
      action.status = "submitted";
    } catch {
      action.status = "unknown";
      action.error =
        "Submission outcome is uncertain. Track this signature before attempting a replacement.";
    }
    await saveAction(action);
    return action;
  });
}
