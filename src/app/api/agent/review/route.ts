import { z } from "zod";
import { endpoint, body } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { account } from "@/features/account/auth";
import { agentStore } from "@/features/copy-trading/agent-store";
import { JupiterProvider } from "@/lib/provider/jupiter";
import { inspectAgentEntry } from "@/features/copy-trading/agent-review";
import {
  readWalletFunds,
  readWalletExposure,
  evaluateWalletReview,
} from "@/features/copy-trading/agent-wallet";
export const runtime = "nodejs";
const input = z
  .object({
    planId: z.string().uuid(),
    decisionId: z.string().uuid(),
    depositAsset: z.enum(["USDC", "JupUSD"]).default("USDC"),
  })
  .strict();
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const user = await account(request);
    if (!user)
      throw new AppError(
        "SIGN_IN_REQUIRED",
        "Sign in to check your private proposal.",
        401,
      );
    const parsed = input.safeParse(await body(request));
    if (!parsed.success)
      throw new AppError(
        "INVALID_REVIEW",
        "Choose a current proposal to inspect.",
        422,
      );
    if (!process.env.JUPITER_API_KEY)
      throw new AppError(
        "SETUP_REQUIRED",
        "Configure Jupiter access before inspecting a real proposal.",
        503,
      );
    const store = agentStore();
    const current = async () => {
      const plan = await store.get(user.wallet);
      if (
        !plan ||
        plan.id !== parsed.data.planId ||
        plan.status !== "watching" ||
        plan.expiresAt <= Date.now()
      )
        throw new AppError(
          "AGENT_CHANGED",
          "This plan is no longer watching. Refresh its status.",
          409,
        );
      const decision = (await store.decisions(plan.id)).find(
        (x) => x.id === parsed.data.decisionId,
      );
      if (
        !decision ||
        decision.status !== "review" ||
        decision.action !== "buy" ||
        decision.expiresAt <= Date.now()
      )
        throw new AppError(
          "PROPOSAL_EXPIRED",
          "This proposal expired or was dismissed. No trade was authorized.",
          409,
        );
      return { plan, decision };
    };
    const { decision } = await current();
    const provider = new JupiterProvider();
    const [report, funds, exposure] = await Promise.all([
      inspectAgentEntry(decision, (path) => provider.request(path)),
      readWalletFunds(user.wallet).catch(() => null),
      readWalletExposure(user.wallet, decision, (path) =>
        provider.request(path),
      ).catch(() => null),
    ]);
    const latest = await current(); // Concurrent pause/dismissal invalidates the review.
    report.checkedAt = Date.now();
    report.wallet = evaluateWalletReview(
      latest.plan,
      latest.decision,
      parsed.data.depositAsset,
      funds,
      exposure,
      await store.reservations(latest.plan.id),
    );
    for (const at of [report.wallet.funds?.at, report.wallet.exposure?.at])
      if (at !== undefined)
        report.expiresAt = Math.min(report.expiresAt, at + 20000);
    await store.saveReview(
      user.wallet,
      latest.plan.id,
      latest.decision,
      report,
    );
    return report;
  });
}
