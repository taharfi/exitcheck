import { randomUUID, randomBytes } from "node:crypto";
import { provider } from "../../lib/provider/index";
import { positionState } from "../../lib/provider/schemas";
import { calculateExit } from "./calculations";
import { units, SCALE } from "../../lib/amounts";
import { AppError } from "../../lib/errors";
import type { Preview, PreparedAction } from "./types";
import {
  inspectTransaction,
  rpc,
  receivedForSignatures,
  assertMainnet,
} from "./transactions";
import { expirePrepared, findActive, insertAction, saveAction } from "./store";
export async function discover(owner: string) {
  const adapter = provider(),
    positions = await adapter.positions(owner);
  const results = [];
  // Bound concurrency; a metadata error marks its position unsupported instead of guessing.
  for (const position of positions) {
    try {
      const m = await adapter.market(position.marketId);
      if (m.marketId !== position.marketId)
        throw new AppError(
          "MARKET_MISMATCH",
          "Provider market identity could not be verified.",
          502,
        );
      position.state = positionState(position, m);
      position.title = m.title;
    } catch {
      position.state = "unsupported";
      position.reason =
        "Market metadata could not be verified. Refresh before taking action.";
    }
    results.push(position);
  }
  return { positions: results, mode: adapter.mode, capturedAt: Date.now() };
}
export async function preview(
  owner: string,
  id: string,
  quantity: string,
): Promise<Preview> {
  const adapter = provider(),
    p = await adapter.position(id);
  if (p.owner !== owner)
    throw new AppError(
      "WRONG_OWNER",
      "This position belongs to a different wallet.",
      403,
    );
  const [m, tradingActive] = await Promise.all([
    adapter.market(p.marketId),
    adapter.tradingStatus(),
  ]);
  if (m.marketId !== p.marketId)
    throw new AppError(
      "MARKET_MISMATCH",
      "Provider market identity could not be verified.",
      502,
    );
  p.state = positionState(p, m);
  p.title = m.title;
  return {
    position: p,
    market: m,
    tradingActive,
    mode: adapter.mode,
    estimate:
      p.state === "open"
        ? calculateExit({
            quantity,
            held: p.quantity,
            isYes: p.isYes,
            depth: await adapter.depth(p.marketId),
            referencePrice: p.markPrice,
          })
        : null,
  };
}
export async function prepare(
  owner: string,
  id: string,
  quantity: string,
  kind: "sell" | "claim",
  minimumPrice: string,
  requestId: string,
) {
  const adapter = provider();
  if (adapter.mode === "fixture")
    throw new AppError(
      "FIXTURE_ONLY",
      "Fixtures cannot prepare real transactions. Configure Jupiter access for the live workflow.",
      422,
    );
  const existing = await findActive(owner, id);
  if (existing && !(await expirePrepared(existing)))
    throw new AppError(
      "ACTION_EXISTS",
      `An existing action must be reconciled before preparing another. Action: ${existing.id}`,
      409,
    );
  const view = await preview(owner, id, quantity),
    p = view.position;
  if (units(p.quantity) === 0n)
    throw new AppError(
      "EMPTY_POSITION",
      "This position has no contracts available for an exit or claim.",
      422,
    );
  if (units(minimumPrice) > SCALE)
    throw new AppError(
      "INVALID_LIMIT",
      "Minimum sale price must be between $0 and $1 per contract.",
      422,
    );
  if (p.openOrders > 0)
    throw new AppError(
      "OPEN_ORDER",
      "An order is already open for this position. Reconcile it in Jupiter before continuing.",
      409,
    );
  if (
    kind === "sell" &&
    (p.state !== "open" ||
      !view.tradingActive ||
      !view.estimate ||
      view.estimate.insufficient)
  )
    throw new AppError(
      "EXIT_UNAVAILABLE",
      "This size cannot currently be verified against available liquidity or trading status.",
      422,
    );
  if (kind === "claim" && p.state !== "claimable")
    throw new AppError(
      "CLAIM_UNAVAILABLE",
      "This position is not currently eligible for a winning claim.",
      422,
    );
  // Reserve the position before provider construction to prevent concurrent builds.
  const action: PreparedAction = {
    id: randomUUID(),
    token: randomBytes(32).toString("hex"),
    owner,
    positionId: id,
    kind,
    quantity,
    createdAt: Date.now(),
    expiresAt: Date.now() + 20000,
    status: "prepared",
    transaction: "",
    blockhash: "",
    lastValidBlockHeight: 0,
    orderId: null,
    signature: null,
    actualReceived: null,
    providerStatus: null,
    expectedGross: null,
    estimatedFee: null,
    expectedNet: null,
    minSellPrice: null,
    networkFee: null,
    asset: "Not verified (USDC or JupUSD)",
    programs: [],
    accounts: [],
    simulation: "Not run",
    signingEnabled: false,
    updatedAt: Date.now(),
  };
  await insertAction(action);
  try {
    if (kind === "sell") {
      const result = await adapter.buildSell(p, quantity),
        o = result.order;
      if (result.executionModel)
        throw new AppError(
          "UNSUPPORTED_EXECUTION",
          "Atomic forecast swaps are outside the supported keeper-order workflow.",
          422,
        );
      if (
        o.userPubkey !== owner ||
        o.positionPubkey !== id ||
        o.marketId !== p.marketId ||
        o.isYes !== p.isYes ||
        o.contractsMicro !== quantity
      )
        throw new AppError(
          "BUILD_MISMATCH",
          "Provider transaction metadata does not match the requested sale.",
          422,
        );
      if (
        o.minSellPriceUsd === null ||
        units(o.minSellPriceUsd) < units(minimumPrice)
      )
        throw new AppError(
          "LIMIT_NOT_ENFORCED",
          "Provider sell floor does not meet your minimum price. No transaction will be signed.",
          422,
        );
      Object.assign(action, {
        transaction: result.transaction,
        blockhash: result.txMeta.blockhash,
        lastValidBlockHeight: result.txMeta.lastValidBlockHeight,
        orderId: o.orderPubkey,
        expectedGross: o.orderCostUsd,
        estimatedFee: o.estimatedTotalFeeUsd,
        minSellPrice: o.minSellPriceUsd,
        executionContext: result.execution?.context,
      });
      if (units(o.estimatedTotalFeeUsd) > units(o.orderCostUsd))
        throw new AppError(
          "INVALID_FEES",
          "Provider fees exceed gross proceeds.",
          422,
        );
      action.expectedNet = (
        units(o.orderCostUsd) - units(o.estimatedTotalFeeUsd)
      ).toString();
    } else {
      const result = await adapter.buildClaim(p),
        c = result.position;
      if (
        c.ownerPubkey !== owner ||
        c.userPubkey !== owner ||
        c.positionPubkey !== id ||
        c.isYes !== p.isYes ||
        c.contractsMicro !== p.quantity ||
        units(c.payoutAmountUsd) !== units(p.quantity)
      )
        throw new AppError(
          "BUILD_MISMATCH",
          "Provider claim metadata does not match this winning position.",
          422,
        );
      Object.assign(action, {
        quantity: p.quantity,
        transaction: result.transaction,
        blockhash: result.txMeta.blockhash,
        lastValidBlockHeight: result.txMeta.lastValidBlockHeight,
        expectedGross: c.payoutAmountUsd,
        estimatedFee: "0",
        expectedNet: c.payoutAmountUsd,
      });
    }
    Object.assign(
      action,
      await inspectTransaction(action.transaction, owner, action.blockhash),
    );
    // The documented overview names JupUSD payouts. The build has no receiving-mint field.
    // Program identities, signer, message and simulation are checked, but instruction
    // semantics remain provider trust and are disclosed before the user's signature.
    action.asset = "JupUSD (provider-documented; not independently verified)";
    action.error =
      "The receiving asset, encoded sell floor, and instruction destinations rely on Jupiter. Program allowlisting and simulation do not fully decode the transaction. This order may remain pending or partially fill.";
    action.expiresAt = Date.now() + 20000;
    await saveAction(action);
    console.info(
      JSON.stringify({
        requestId,
        event: "action_prepared",
        actionId: action.id,
      }),
    );
    return action;
  } catch (error) {
    action.status = "failed";
    action.error =
      error instanceof AppError
        ? error.message
        : "Transaction preparation failed validation.";
    await saveAction(action);
    throw error;
  }
}
export async function reconcile(action: PreparedAction) {
  if (!action.signature) return action;
  if (
    ["filled", "claimed", "rejected", "failed", "cancelled"].includes(
      action.status,
    )
  )
    return action;
  const connection = rpc();
  await assertMainnet(connection);
  const response = await connection.getSignatureStatuses([action.signature], {
    searchTransactionHistory: true,
  });
  const chain = response.value[0];
  action.updatedAt = Date.now();
  if (!chain) {
    action.status = "unknown";
    action.error =
      "Transaction outcome is not yet known. Reconcile this action before preparing a replacement.";
    await saveAction(action);
    return action;
  }
  if (chain.err) {
    action.status = "failed";
    action.error = "The on-chain transaction failed.";
    await saveAction(action);
    return action;
  }
  if (!["confirmed", "finalized"].includes(chain.confirmationStatus ?? "")) {
    action.status = "submitted";
    await saveAction(action);
    return action;
  }
  action.status = "confirmed";
  await saveAction(action);
  const adapter = provider();
  try {
    if (action.kind === "claim") {
      const p = await adapter.position(action.positionId);
      if (p.owner !== action.owner)
        throw new AppError(
          "WRONG_OWNER",
          "Claim reconciliation returned a different owner.",
          502,
        );
      const received = await receivedForSignatures(
        [action.signature],
        action.owner,
        action.positionId,
      );
      if (p.claimed && received) {
        action.status = "claimed";
        action.actualReceived = received.amount;
        action.asset = received.asset;
      }
    } else if (action.orderId) {
      try {
        const status = await adapter.orderStatus(action.orderId);
        if (status.orderPubkey !== action.orderId)
          throw new AppError(
            "ORDER_MISMATCH",
            "Provider returned a different order.",
            502,
          );
        action.providerStatus = status.status;
        action.status =
          status.status === "filled"
            ? "filled"
            : status.status === "partiallyfilled"
              ? "partially-filled"
              : status.status === "failed"
                ? "failed"
                : status.status === "cancelled"
                  ? "cancelled"
                  : "order-pending";
        const signatures = status.history
          .filter((h) => h.eventType === "order_filled")
          .map((h) => h.signature);
        const received = await receivedForSignatures(
          signatures,
          action.owner,
          action.orderId,
        );
        if (received) {
          action.actualReceived = received.amount;
          action.asset = received.asset;
        }
        if (action.status === "filled" && !received) {
          action.status = "unknown";
          action.error =
            "Jupiter reports a fill, but the associated confirmed payout could not be independently attributed. Reconcile before preparing another action.";
        }
      } catch (error) {
        if (error instanceof AppError && [400, 404].includes(error.status)) {
          action.status = "order-pending";
          action.error =
            "Order history is not yet indexed. On-chain confirmation is not a completed sale.";
        } else throw error;
      }
    }
  } catch (error) {
    if (["filled", "claimed"].includes(action.status))
      action.status = "unknown";
    action.error =
      error instanceof AppError
        ? `On-chain confirmation is verified; provider/result tracking is unavailable. ${error.message}`
        : "On-chain confirmation is verified; the fill or payout could not yet be reconciled. Refresh this existing action.";
  }
  await saveAction(action);
  return action;
}
