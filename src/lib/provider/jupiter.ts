import { z } from "zod";
import { parse, isLosslessNumber } from "lossless-json";
import { AppError } from "../errors";
import { readLimitedText } from "../read-limited-text";
import type { Provider } from "./interface";
import type { Position } from "../../features/exits/types";
import {
  marketSchema,
  parsePosition,
  parseDepth,
  sellBuildSchema,
  claimBuildSchema,
  orderStatusSchema,
} from "./schemas";
const BASE = "https://api.jup.ag/prediction/v1";
// Financial JSON numbers remain strings. Only non-financial metadata becomes a JS number.
export function parseProviderJson(text: string): unknown {
  return parse(text, (key, value) => {
    if (!isLosslessNumber(value)) return value;
    return [
      "closeTime",
      "openTime",
      "openOrders",
      "lastValidBlockHeight",
      "start",
      "end",
      "total",
      "timestamp",
      "slot",
    ].includes(key)
      ? Number(value.value)
      : value.value;
  });
}
export class JupiterProvider implements Provider {
  mode = "production" as const;
  constructor(
    private key = process.env.JUPITER_API_KEY,
    private transport: typeof fetch = fetch,
  ) {}
  async request(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<unknown> {
    if (!this.key)
      throw new AppError(
        "SETUP_REQUIRED",
        "Jupiter access is not configured. Add JUPITER_API_KEY to .env.local and restart the server.",
        503,
      );
    for (let attempt = 0; attempt < (method === "GET" ? 2 : 1); attempt++) {
      try {
        const response = await this.transport(`${BASE}${path}`, {
          method,
          headers: {
            "x-api-key": this.key,
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
          cache: "no-store",
        });
        if (response.status >= 500 && method === "GET" && attempt === 0)
          continue;
        if (!response.ok) {
          const code =
            response.status === 429
              ? "RATE_LIMIT"
              : response.status === 401
                ? "PROVIDER_AUTH"
                : response.status === 403
                  ? "ACCESS_RESTRICTED"
                  : "PROVIDER_ERROR";
          const message =
            response.status === 429
              ? "Jupiter rate limit reached. Wait before refreshing."
              : response.status === 401
                ? "Jupiter rejected the API key. Check provider access."
                : response.status === 403
                  ? "Jupiter access is restricted for this deployment. Check account and regional eligibility."
                  : `Jupiter returned HTTP ${response.status}. Refresh or reconcile the existing action before trying again.`;
          throw new AppError(
            code,
            message,
            response.status >= 500 ? 502 : response.status,
          );
        }
        const text = await readLimitedText(
          response,
          2_000_000,
          () =>
            new AppError(
              "INVALID_PROVIDER_DATA",
              "Provider response exceeded the allowed size.",
              502,
            ),
        );
        return parseProviderJson(text);
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (method === "GET" && attempt === 0) continue;
        throw new AppError(
          "PROVIDER_TIMEOUT",
          "Provider request failed or timed out. No automatic transaction retry was made.",
          502,
        );
      }
    }
    throw new AppError("PROVIDER_ERROR", "Provider is unavailable.", 502);
  }
  async positions(owner: string) {
    const positions: Position[] = [];
    for (let start = 0; start < 500; start += 100) {
      const result = z
        .object({
          data: z.array(z.unknown()),
          pagination: z.object({ hasNext: z.boolean() }).optional(),
        })
        .parse(
          await this.request(
            `/positions?${new URLSearchParams({ ownerPubkey: owner, start: String(start), end: String(start + 100) })}`,
          ),
        );
      for (const item of result.data) {
        try {
          const p = parsePosition(item);
          if (p.owner !== owner) throw new Error("Wrong owner");
          positions.push(p);
        } catch {
          throw new AppError(
            "UNVERIFIABLE_POSITIONS",
            "A position returned by Jupiter could not be verified. No balances or exit estimates have been inferred.",
            502,
          );
        }
      }
      if (!result.pagination?.hasNext) return positions;
    }
    throw new AppError(
      "POSITION_LIMIT",
      "This wallet exceeds the supported 500-position lookup limit.",
      422,
    );
  }
  async position(id: string) {
    return parsePosition(
      await this.request(`/positions/${encodeURIComponent(id)}`),
    );
  }
  async market(id: string) {
    return marketSchema.parse(
      await this.request(`/markets/${encodeURIComponent(id)}`),
    );
  }
  async tradingStatus() {
    return z
      .object({ trading_active: z.boolean() })
      .parse(await this.request("/trading-status")).trading_active;
  }
  async depth(id: string) {
    return parseDepth(
      await this.request(`/orderbook/${encodeURIComponent(id)}`),
    );
  }
  async buildSell(p: Position, quantity: string) {
    return sellBuildSchema.parse(
      await this.request("/orders", "POST", {
        ownerPubkey: p.owner,
        positionPubkey: p.id,
        marketId: p.marketId,
        isBuy: false,
        isYes: p.isYes,
        contractsMicro: quantity,
      }),
    );
  }
  async buildClaim(p: Position) {
    return claimBuildSchema.parse(
      await this.request(
        `/positions/${encodeURIComponent(p.id)}/claim`,
        "POST",
        { ownerPubkey: p.owner },
      ),
    );
  }
  async orderStatus(id: string) {
    return orderStatusSchema.parse(
      await this.request(`/orders/status/${encodeURIComponent(id)}`),
    );
  }
}
