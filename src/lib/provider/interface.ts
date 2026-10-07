import type { Depth, Market, Position } from "../../features/exits/types";
import type { z } from "zod";
import type {
  claimBuildSchema,
  sellBuildSchema,
  orderStatusSchema,
} from "./schemas";
export interface Provider {
  mode: "production" | "fixture";
  positions(owner: string): Promise<Position[]>;
  position(id: string): Promise<Position>;
  market(id: string): Promise<Market>;
  tradingStatus(): Promise<boolean>;
  depth(id: string): Promise<Depth>;
  buildSell(
    position: Position,
    quantity: string,
  ): Promise<z.infer<typeof sellBuildSchema>>;
  buildClaim(position: Position): Promise<z.infer<typeof claimBuildSchema>>;
  orderStatus(id: string): Promise<z.infer<typeof orderStatusSchema>>;
}
