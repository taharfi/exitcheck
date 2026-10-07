import { z } from "zod";
import { endpoint, body } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { account } from "@/features/account/auth";
import { JupiterProvider } from "@/lib/provider/jupiter";
import {
  agentSettings,
  agentCoverage,
  type AgentSnapshot,
} from "@/features/copy-trading/agent-model";
import { agentStore } from "@/features/copy-trading/agent-store";
import { collectAgentPlan } from "@/features/copy-trading/agent-collector";
export const runtime = "nodejs";

async function snapshot(wallet: string | null): Promise<AgentSnapshot> {
  const store = agentStore(),
    plan = wallet ? await store.get(wallet) : null;
  return {
    signedIn: !!wallet,
    plan,
    decisions: plan ? await store.decisions(plan.id) : [],
    journal: wallet ? await store.journal(wallet) : [],
    monitoring: wallet ? await store.monitoring(wallet) : null,
    reserved: plan ? (await store.reservations(plan.id)).total.toString() : "0",
    collectorEnabled: process.env.AGENT_COLLECTOR_ENABLED === "true",
    providerConfigured: !!process.env.JUPITER_API_KEY,
    execution: "disabled",
    coverage: agentCoverage,
  };
}
export async function GET(request: Request) {
  return endpoint(
    request,
    async () => await snapshot((await account(request))?.wallet ?? null),
  );
}
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), settings: agentSettings }).strict(),
  z
    .object({
      action: z.enum(["pause", "resume", "stop", "refresh"]),
      planId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("dismiss"),
      planId: z.string().uuid(),
      decisionId: z.string().uuid(),
    })
    .strict(),
]);
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const user = await account(request);
    if (!user)
      throw new AppError(
        "SIGN_IN_REQUIRED",
        "Sign in with your wallet to save a private agent plan. Login does not authorize trades.",
        401,
      );
    const parsed = inputSchema.safeParse(await body(request));
    if (!parsed.success)
      throw new AppError(
        "INVALID_AGENT_SETTINGS",
        parsed.error.issues[0]?.message ?? "Invalid agent request.",
        422,
      );
    const input = parsed.data,
      store = agentStore();
    if (["start", "resume", "refresh"].includes(input.action)) {
      if (process.env.AGENT_COLLECTOR_ENABLED !== "true")
        throw new AppError(
          "AGENT_COLLECTOR_DISABLED",
          "Agent observation is disabled on this server.",
          503,
        );
      if (!process.env.JUPITER_API_KEY)
        throw new AppError(
          "SETUP_REQUIRED",
          "Configure Jupiter access before watching a real trader.",
          503,
        );
    }
    if (input.action === "start") {
      const plan = await store.create(user.wallet, input.settings);
      await collectAgentPlan(store, plan, (path) =>
        new JupiterProvider().request(path),
      );
      return await snapshot(user.wallet);
    }
    const plan = await store.get(user.wallet);
    if (!plan || plan.id !== input.planId)
      throw new AppError(
        "AGENT_CHANGED",
        "This plan is no longer current. Refresh before making changes.",
        409,
      );
    if (input.action === "dismiss")
      await store.dismiss(user.wallet, input.decisionId);
    else if (input.action === "refresh") {
      if (plan.status !== "watching" || plan.expiresAt <= Date.now())
        throw new AppError(
          "AGENT_NOT_WATCHING",
          "Resume watching or start a new plan before checking activity.",
          409,
        );
      if (plan.lastPoll !== null && Date.now() - plan.lastPoll < 15000)
        throw new AppError(
          "AGENT_POLL_WAIT",
          "Wait 15 seconds between source checks.",
          429,
        );
      await collectAgentPlan(store, plan, (path) =>
        new JupiterProvider().request(path),
      );
    } else
      await store.change(user.wallet, input.action, Date.now(), input.planId);
    return await snapshot(user.wallet);
  });
}
