import type { AgentEntryReview } from "./agent-review";

/** Summarizes observation evidence; it never grants permission to execute. */
export function summarizeAgentReview(report: AgentEntryReview, now: number) {
  if (now >= report.expiresAt)
    return {
      status: "incomplete" as const,
      title: "Refresh this review",
      reason:
        "The snapshot expired. Check current prices and wallet funds again.",
    };
  if (report.entry.status === "blocked" || report.wallet?.status === "blocked")
    return {
      status: "blocked" as const,
      title: "This proposal failed a planning check",
      reason: [
        report.entry.status === "blocked" ? report.entry.reason : null,
        report.wallet?.status === "blocked" ? report.wallet.reason : null,
      ]
        .filter(Boolean)
        .join(" "),
    };
  if (report.entry.status !== "within_limit")
    return {
      status: "incomplete" as const,
      title: "The price check is incomplete",
      reason: report.entry.reason,
    };
  if (report.wallet?.status !== "within_budget")
    return {
      status: "incomplete" as const,
      title: "The wallet check is incomplete",
      reason:
        report.wallet?.reason ?? "Wallet funds and exposure were not verified.",
    };
  if (report.exit.status !== "covered")
    return {
      status: "incomplete" as const,
      title:
        report.exit.status === "limited"
          ? "Exit liquidity covers only part of this size"
          : "Exit liquidity is not verified",
      reason: report.exit.reason,
    };
  return {
    status: "checked" as const,
    title: "Price and budget checks passed",
    reason:
      "Buy liquidity, total costs and enforced trade limits still need verification. Wallet approval is unavailable; no trade was placed.",
  };
}
