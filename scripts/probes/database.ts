import nextEnv from "@next/env";
import { randomUUID } from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { AgentStore } from "../../src/features/copy-trading/agent-store";
import { ShadowStore } from "../../src/features/copy-trading/shadow-store";
import { AuthStore } from "../../src/features/account/auth";

nextEnv.loadEnvConfig(process.cwd(), false);
process.env.EXITCHECK_DATABASE = "turso";
const pair = nacl.sign.keyPair();
const wallet = bs58.encode(pair.publicKey);
const trader = bs58.encode(nacl.sign.keyPair().publicKey);
const agents = new AgentStore("remote-probe");
const second = new AgentStore("remote-probe-second");
const shadow = new ShadowStore("remote-probe-auth");
const auth = new AuthStore(shadow);
let planId: string | undefined;
try {
  const challenge = await auth.challenge(wallet, "https://exitcheck.xyz");
  const signature = bs58.encode(
    nacl.sign.detached(
      new TextEncoder().encode(challenge.message),
      pair.secretKey,
    ),
  );
  const proofs = await Promise.allSettled([
    auth.verify(challenge.token, signature, "https://exitcheck.xyz"),
    auth.verify(challenge.token, signature, "https://exitcheck.xyz"),
  ]);
  if (proofs.filter((p) => p.status === "fulfilled").length !== 1)
    throw new Error("Login replay protection failed");
  const proof = proofs.find((p) => p.status === "fulfilled");
  if (
    !proof ||
    proof.status !== "fulfilled" ||
    (await auth.user(proof.value.token))?.wallet !== wallet
  )
    throw new Error("Remote session persistence failed");
  const plan = await agents.create(wallet, {
    trader,
    budget: "100",
    entry: "10",
  });
  planId = plan.id;
  if ((await second.get(wallet))?.id !== plan.id)
    throw new Error("Cross-connection plan persistence failed");
  const leases = await Promise.all([
    agents.acquire(plan),
    second.acquire(plan),
  ]);
  if (leases.filter(Boolean).length !== 1)
    throw new Error("Cross-connection lease protection failed");
  const token = leases.find(Boolean)!;
  await second.change(wallet, "pause");
  if (
    await agents.commit(plan, token, plan, [], Date.now(), {
      startedAt: Date.now(),
      at: Date.now(),
      kind: "overlap",
      pages: 1,
      errorCode: null,
    })
  )
    throw new Error("Stale poll overrode paused plan");
  // A failed write must roll back through the remote transaction context.
  const marker = randomUUID();
  try {
    await agents.db.session(async () => {
      await agents.db.exec("BEGIN IMMEDIATE");
      await agents.db
        .prepare("INSERT INTO copy_agent_polls VALUES(?,?,?)")
        .run(marker, 0, "{}");
      throw new Error("Deliberate rollback probe");
    });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "Deliberate rollback probe"
    )
      throw error;
  }
  if (
    await second.db
      .prepare("SELECT plan FROM copy_agent_polls WHERE plan=?")
      .get(marker)
  )
    throw new Error("Remote transaction rollback failed");
  console.log(
    JSON.stringify({
      database: "turso",
      loginReplayBlocked: true,
      sessionPersisted: true,
      planPersistedAcrossConnections: true,
      exclusiveLease: true,
      stalePollBlocked: true,
      transactionRollback: true,
      tradesSigned: 0,
      tradesSubmitted: 0,
    }),
  );
} finally {
  if (planId) {
    await agents.db
      .prepare("DELETE FROM copy_agent_polls WHERE plan=?")
      .run(planId);
    await agents.db
      .prepare("DELETE FROM copy_agent_decisions WHERE plan=?")
      .run(planId);
    await agents.db
      .prepare("DELETE FROM copy_agent_journal WHERE plan=?")
      .run(planId);
  }
  await agents.db.prepare("DELETE FROM copy_agents WHERE wallet=?").run(wallet);
  await shadow.db
    .prepare("DELETE FROM login_sessions WHERE wallet=?")
    .run(wallet);
  await shadow.db
    .prepare("DELETE FROM login_challenges WHERE wallet=?")
    .run(wallet);
  agents.db.close();
  second.db.close();
  shadow.db.close();
}
