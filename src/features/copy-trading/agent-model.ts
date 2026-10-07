import { z } from "zod";
import { address } from "@/lib/provider/schemas";
import { decimalToMicro } from "@/lib/amounts";
import type { AgentJournalEntry } from "./agent-journal";
import type { AgentMonitoringReport } from "./agent-monitoring";

const budgetPattern = /^\d{1,7}(\.\d{1,2})?$/;
const entryPattern = /^\d{1,5}(\.\d{1,2})?$/;
export const agentSettings = z
  .object({
    trader: address,
    budget: z.string().regex(budgetPattern),
    entry: z.string().regex(entryPattern),
  })
  .strict()
  .superRefine((value, context) => {
    if (!budgetPattern.test(value.budget) || !entryPattern.test(value.entry))
      return;
    const budget = decimalToMicro(value.budget),
      entry = decimalToMicro(value.entry);
    if (budget < 25_000_000n || budget > 1_000_000_000_000n)
      context.addIssue({
        code: "custom",
        message: "Use a planning budget of $25 to $1,000,000.",
        path: ["budget"],
      });
    if (entry < 5_000_000n || entry > 500_000_000n || entry > budget / 5n)
      context.addIssue({
        code: "custom",
        message: "Entry size must be $5–$500 and at most 20% of the budget.",
        path: ["entry"],
      });
  });
export type AgentSettings = z.infer<typeof agentSettings>;
export type AgentPlan = {
  id: string;
  wallet: string;
  trader: string;
  budget: string;
  entry: string;
  status: "watching" | "paused" | "stopped";
  revision: number;
  createdAt: number;
  acceptAfter: number;
  expiresAt: number;
  cursor: { id: string; fingerprint: string } | null;
  lastPoll: number | null;
  lastSuccess: number | null;
  polls: number;
  pages: number;
  gaps: number;
  error: string | null;
};
export type AgentDecision = {
  id: string;
  planId: string;
  sourceId: string;
  sourceSignature: string | null;
  sourceAt: number;
  observedAt: number;
  expiresAt: number;
  marketId: string;
  eventId: string;
  title: string;
  side: "yes" | "no";
  action: "buy" | "sell";
  leaderPrice: string;
  leaderContracts: string;
  quotePrice: string | null;
  quoteAt: number | null;
  allocation: string;
  status: "review" | "skipped" | "exit_signal" | "dismissed" | "expired";
  reason: string;
};
export const agentCoverage =
  "Wallet-specific provider history with overlap checks, up to four pages per poll. This is not independent on-chain verification or a guarantee that the provider reports every fill. Prices are indicative; follower fees and executable buy depth remain unverified.";
export type AgentSnapshot = {
  monitoring?: AgentMonitoringReport | null;
  journal?: AgentJournalEntry[];
  signedIn: boolean;
  plan: AgentPlan | null;
  decisions: AgentDecision[];
  collectorEnabled: boolean;
  providerConfigured: boolean;
  execution: "disabled";
  reserved: string;
  coverage: string;
};
