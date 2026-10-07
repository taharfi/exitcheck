import { AppError } from "../errors";
import type { Provider } from "./interface";
import type { Position, Market } from "../../features/exits/types";
export const FIXTURE_OWNER = "11111111111111111111111111111111";
export const fixturePositions: Position[] = [
  {
    id: "fixture-open",
    owner: FIXTURE_OWNER,
    marketId: "fixture-election",
    title: "Will the city approve its transit expansion?",
    isYes: true,
    quantity: "120000000",
    value: "81600000",
    markPrice: "680000",
    claimable: false,
    claimed: false,
    claimedUsd: "0",
    payout: "120000000",
    openOrders: 0,
    state: "open",
  },
  {
    id: "fixture-claim",
    owner: FIXTURE_OWNER,
    marketId: "fixture-resolved",
    title: "Will the launch take place before September 30?",
    isYes: true,
    quantity: "45000000",
    value: null,
    markPrice: null,
    claimable: true,
    claimed: false,
    claimedUsd: "0",
    payout: "45000000",
    openOrders: 0,
    state: "claimable",
  },
  {
    id: "fixture-wait",
    owner: FIXTURE_OWNER,
    marketId: "fixture-pending",
    title: "Will the season finish with a new record?",
    isYes: false,
    quantity: "20000000",
    value: null,
    markPrice: null,
    claimable: false,
    claimed: false,
    claimedUsd: "0",
    payout: "20000000",
    openOrders: 0,
    state: "awaiting-resolution",
  },
  {
    id: "fixture-lost",
    owner: FIXTURE_OWNER,
    marketId: "fixture-lost",
    title: "Will the final match end in a draw?",
    isYes: true,
    quantity: "15000000",
    value: null,
    markPrice: null,
    claimable: false,
    claimed: false,
    claimedUsd: "0",
    payout: "15000000",
    openOrders: 0,
    state: "no-payout",
  },
  {
    id: "fixture-unsupported",
    owner: FIXTURE_OWNER,
    marketId: "fixture-unsupported",
    title: "Automatically settled forecast position",
    isYes: true,
    quantity: "5000000",
    value: null,
    markPrice: null,
    claimable: false,
    claimed: false,
    claimedUsd: "0",
    payout: "5000000",
    openOrders: 0,
    state: "unsupported",
  },
];
export class FixtureProvider implements Provider {
  mode = "fixture" as const;
  async positions() {
    return structuredClone(fixturePositions);
  }
  async position(id: string) {
    const p = fixturePositions.find((p) => p.id === id);
    if (!p) throw new AppError("NOT_FOUND", "Fixture position not found.", 404);
    return structuredClone(p);
  }
  async market(id: string): Promise<Market> {
    const p = fixturePositions.find((p) => p.marketId === id);
    if (!p) throw new AppError("NOT_FOUND", "Fixture market not found.", 404);
    return {
      marketId: id,
      title: p.title,
      provider: id === "fixture-unsupported" ? "bisonfi" : "polymarket",
      status: p.state === "open" ? "open" : "closed",
      result:
        p.state === "claimable" ? "yes" : p.state === "no-payout" ? "no" : null,
      closeTime:
        p.state === "open"
          ? Date.now() / 1000 + 86400
          : Date.now() / 1000 - 86400,
    };
  }
  async tradingStatus() {
    return true;
  }
  async depth() {
    return {
      capturedAt: Date.now(),
      yes: [
        { price: "670000", quantity: "30000000" },
        { price: "650000", quantity: "40000000" },
        { price: "610000", quantity: "35000000" },
      ],
      no: [{ price: "310000", quantity: "200000000" }],
    };
  }
  async buildSell(): Promise<never> {
    throw new AppError(
      "FIXTURE_ONLY",
      "Development fixtures cannot construct or sign financial transactions.",
      422,
    );
  }
  async buildClaim(): Promise<never> {
    throw new AppError(
      "FIXTURE_ONLY",
      "Development fixtures cannot construct or sign claim transactions.",
      422,
    );
  }
  async orderStatus(): Promise<never> {
    throw new AppError(
      "FIXTURE_ONLY",
      "No live order exists in fixture mode.",
      422,
    );
  }
}
