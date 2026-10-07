import type { AgentDecision } from "./agent-model";
import type { AgentEntryReview } from "./agent-review";
export type AgentJournalEntry = {
  id: string;
  planId: string;
  decision: AgentDecision;
  review: AgentEntryReview;
  outcome: "not_executed";
};
