export type PositionState =
  | "open"
  | "awaiting-resolution"
  | "claimable"
  | "no-payout"
  | "claimed"
  | "unsupported";
export interface Position {
  id: string;
  owner: string;
  marketId: string;
  title: string;
  isYes: boolean;
  quantity: string;
  value: string | null;
  markPrice: string | null;
  claimable: boolean;
  claimed: boolean;
  claimedUsd: string;
  payout: string;
  openOrders: number;
  state: PositionState;
  reason?: string;
}
export interface Market {
  marketId: string;
  title: string;
  provider: string;
  status: string;
  result: "yes" | "no" | null;
  closeTime: number;
}
export interface Level {
  price: string;
  quantity: string;
}
export interface Depth {
  yes: Level[];
  no: Level[];
  capturedAt: number;
}
export interface Estimate {
  requested: string;
  fillable: string;
  gross: string;
  fee: string | null;
  net: string | null;
  remaining: string;
  averagePrice: string | null;
  referenceValue: string | null;
  impactBps: string | null;
  impactReferencePrice: string | null;
  insufficient: boolean;
  capturedAt: number;
}
export interface Preview {
  position: Position;
  market: Market;
  tradingActive: boolean;
  estimate: Estimate | null;
  mode: "production" | "fixture";
}
export type ActionStatus =
  | "prepared"
  | "awaiting-signature"
  | "rejected"
  | "submitting"
  | "submitted"
  | "confirmed"
  | "order-pending"
  | "partially-filled"
  | "filled"
  | "failed"
  | "cancelled"
  | "unknown"
  | "claimed";
export interface PreparedAction {
  id: string;
  token: string;
  owner: string;
  positionId: string;
  kind: "sell" | "claim";
  quantity: string;
  createdAt: number;
  expiresAt: number;
  status: ActionStatus;
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
  orderId: string | null;
  signature: string | null;
  actualReceived: string | null;
  providerStatus: string | null;
  expectedGross: string | null;
  estimatedFee: string | null;
  expectedNet: string | null;
  minSellPrice: string | null;
  networkFee: string | null;
  asset: string;
  programs: string[];
  accounts: string[];
  simulation: string;
  signingEnabled: boolean;
  executionContext?: Record<string, unknown>;
  updatedAt: number;
  error?: string;
}
