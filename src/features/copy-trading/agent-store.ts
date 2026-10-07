import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { openSqlite } from "@/lib/server/sqlite";
import { AppError } from "@/lib/errors";
import { decimalToMicro } from "@/lib/amounts";
import type { AgentEntryReview } from "./agent-review";
import type { AgentJournalEntry } from "./agent-journal";
import { summarizeAgentMonitoring, type AgentPoll } from "./agent-monitoring";
import {
  agentSettings,
  type AgentPlan,
  type AgentDecision,
  type AgentSettings,
} from "./agent-model";

export class AgentStore {
  readonly db;
  constructor(path: string) {
    this.db = openSqlite(path);
    this.db
      .initialize(`CREATE TABLE IF NOT EXISTS copy_agents(id TEXT PRIMARY KEY,wallet TEXT NOT NULL UNIQUE,revision INTEGER NOT NULL,status TEXT NOT NULL,expires INTEGER NOT NULL,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS copy_agent_decisions(id TEXT PRIMARY KEY,plan TEXT NOT NULL,source TEXT NOT NULL,status TEXT NOT NULL,expires INTEGER NOT NULL,at INTEGER NOT NULL,body TEXT NOT NULL,UNIQUE(plan,source));
      CREATE INDEX IF NOT EXISTS copy_agent_decisions_plan ON copy_agent_decisions(plan,at);`);
    this.db
      .initialize(`CREATE TABLE IF NOT EXISTS copy_agent_journal(id TEXT PRIMARY KEY,wallet TEXT NOT NULL,plan TEXT NOT NULL,at INTEGER NOT NULL,body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS copy_agent_journal_wallet ON copy_agent_journal(wallet,at);`);
    this.db.initialize(
      `CREATE TABLE IF NOT EXISTS copy_agent_polls(plan TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(plan,revision));`,
    );
  }
  async monitoring(wallet: string, now = Date.now()) {
    return await this.db.session(async () => {
      const plan = await this.get(wallet);
      if (!plan) return null;
      const decisions = await this.db
        .prepare("SELECT body FROM copy_agent_decisions WHERE plan=?")
        .iterate(plan.id);
      const polls = await this.db
        .prepare(
          "SELECT body FROM copy_agent_polls WHERE plan=? ORDER BY revision",
        )
        .iterate(plan.id);
      function* bodies<T>(rows: Iterable<Record<string, unknown>>) {
        for (const row of rows) yield JSON.parse(row.body as string) as T;
      }
      return summarizeAgentMonitoring(
        plan,
        bodies<AgentDecision>(decisions),
        bodies<AgentPoll>(polls),
        now,
      );
    });
  }
  async journal(wallet: string): Promise<AgentJournalEntry[]> {
    return await this.db.session(async () => {
      return (
        (await this.db
          .prepare(
            "SELECT body FROM copy_agent_journal WHERE wallet=? ORDER BY at DESC,id DESC LIMIT 50",
          )
          .all(wallet)) as { body: string }[]
      ).map((row) => JSON.parse(row.body));
    });
  }
  async saveReview(
    wallet: string,
    planId: string,
    decision: AgentDecision,
    review: AgentEntryReview,
    now = Date.now(),
  ) {
    return await this.db.session(async () => {
      await this.db.exec("BEGIN IMMEDIATE");
      try {
        const plan = await this.get(wallet);
        const current = (await this.decisions(planId, now)).find(
          (d) => d.id === decision.id,
        );
        if (
          !plan ||
          plan.id !== planId ||
          plan.status !== "watching" ||
          plan.expiresAt <= now ||
          !current ||
          current.status !== "review" ||
          review.decisionId !== current.id
        )
          throw new AppError(
            "AGENT_CHANGED",
            "The proposal changed before its review could be saved.",
            409,
          );
        const entry: AgentJournalEntry = {
          id: randomUUID(),
          planId,
          decision: current,
          review,
          outcome: "not_executed",
        };
        await this.db
          .prepare("INSERT INTO copy_agent_journal VALUES(?,?,?,?,?)")
          .run(
            entry.id,
            wallet,
            planId,
            review.checkedAt,
            JSON.stringify(entry),
          );
        await this.db.exec("COMMIT");
        return entry;
      } catch (error) {
        await this.db.exec("ROLLBACK");
        throw error;
      }
    });
  }
  async get(wallet: string): Promise<AgentPlan | null> {
    return await this.db.session(async () => {
      const row = (await this.db
        .prepare("SELECT body FROM copy_agents WHERE wallet=?")
        .get(wallet)) as { body: string } | undefined;
      return row ? JSON.parse(row.body) : null;
    });
  }
  async active(now = Date.now()): Promise<AgentPlan[]> {
    return await this.db.session(async () => {
      return (
        (await this.db
          .prepare(
            "SELECT body FROM copy_agents WHERE status='watching' AND expires>? ORDER BY wallet",
          )
          .all(now)) as { body: string }[]
      ).map((x) => JSON.parse(x.body));
    });
  }
  async create(wallet: string, input: AgentSettings, now = Date.now()) {
    return await this.db.session(async () => {
      const settings = agentSettings.parse(input);
      if (wallet === settings.trader)
        throw new AppError(
          "SELF_COPY",
          "Choose a different trader wallet to avoid copying your own activity.",
          422,
        );
      await this.db.exec("BEGIN IMMEDIATE");
      try {
        const old = await this.get(wallet);
        if (old && old.status !== "stopped" && old.expiresAt > now)
          throw new AppError(
            "AGENT_EXISTS",
            "Stop the existing plan before starting another.",
            409,
          );
        if ((await this.active(now)).length >= 5)
          throw new AppError(
            "AGENT_CAPACITY",
            "This server is watching five agent plans. Try again later.",
            429,
          );
        const plan: AgentPlan = {
          id: randomUUID(),
          wallet,
          trader: settings.trader,
          budget: decimalToMicro(settings.budget).toString(),
          entry: decimalToMicro(settings.entry).toString(),
          status: "watching",
          revision: 0,
          createdAt: now,
          acceptAfter: now,
          expiresAt: now + 7 * 86400000,
          cursor: null,
          lastPoll: null,
          lastSuccess: null,
          polls: 0,
          pages: 0,
          gaps: 0,
          error: null,
        };
        await this.db
          .prepare(
            "INSERT INTO copy_agents(id,wallet,revision,status,expires,body) VALUES(?,?,?,?,?,?) ON CONFLICT(wallet) DO UPDATE SET id=excluded.id,revision=0,status=excluded.status,expires=excluded.expires,lease=NULL,lease_until=0,body=excluded.body",
          )
          .run(
            plan.id,
            wallet,
            0,
            plan.status,
            plan.expiresAt,
            JSON.stringify(plan),
          );
        await this.db.exec("COMMIT");
        return plan;
      } catch (e) {
        await this.db.exec("ROLLBACK");
        throw e;
      }
    });
  }
  async decisions(
    plan: string,
    now = Date.now(),
    limit = 200,
  ): Promise<AgentDecision[]> {
    return await this.db.session(async () => {
      return (
        (await this.db
          .prepare(
            "SELECT body,status FROM copy_agent_decisions WHERE plan=? ORDER BY at DESC,id DESC LIMIT ?",
          )
          .all(plan, limit)) as {
          body: string;
          status: AgentDecision["status"];
        }[]
      ).map((row) => {
        const decision: AgentDecision = {
          ...JSON.parse(row.body),
          status: row.status,
        };
        return decision.status === "review" && decision.expiresAt <= now
          ? {
              ...decision,
              status: "expired",
              reason:
                "The proposal expired. A new quote and execution review would be required.",
            }
          : decision;
      });
    });
  }
  async reservations(
    plan: string,
    now = Date.now(),
  ): Promise<{ total: bigint; events: Map<string, bigint> }> {
    return await this.db.session(async () => {
      const rows = (await this.db
        .prepare(
          "SELECT body FROM copy_agent_decisions WHERE plan=? AND status='review' AND expires>?",
        )
        .all(plan, now)) as { body: string }[];
      let total = 0n;
      const events = new Map<string, bigint>();
      for (const row of rows) {
        const d: AgentDecision = JSON.parse(row.body);
        const amount = BigInt(d.allocation);
        total += amount;
        events.set(d.eventId, (events.get(d.eventId) ?? 0n) + amount);
      }
      return { total, events };
    });
  }
  async change(
    wallet: string,
    action: "pause" | "resume" | "stop",
    now = Date.now(),
    expectedPlanId?: string,
  ) {
    return await this.db.session(async () => {
      await this.db.exec("BEGIN IMMEDIATE");
      try {
        const plan = await this.get(wallet);
        if (!plan)
          throw new AppError(
            "AGENT_NOT_FOUND",
            "No agent plan is saved for this wallet.",
            404,
          );
        if (expectedPlanId && plan.id !== expectedPlanId)
          throw new AppError(
            "AGENT_CHANGED",
            "This plan is no longer current. Refresh before making changes.",
            409,
          );
        if (plan.status === "stopped" && action !== "stop")
          throw new AppError(
            "AGENT_ENDED",
            "This plan was stopped. Start a new plan.",
            409,
          );
        if (
          action === "resume" &&
          (plan.status === "stopped" || plan.expiresAt <= now)
        )
          throw new AppError(
            "AGENT_ENDED",
            "This plan ended. Start a new plan.",
            409,
          );
        if (action === "resume" && plan.status === "watching") {
          await this.db.exec("COMMIT");
          return plan;
        }
        if (action === "resume" && (await this.active(now)).length >= 5)
          throw new AppError(
            "AGENT_CAPACITY",
            "This server is at monitoring capacity.",
            429,
          );
        plan.status =
          action === "resume"
            ? "watching"
            : action === "pause"
              ? "paused"
              : "stopped";
        plan.revision++;
        if (action === "resume") {
          plan.cursor = null;
          plan.acceptAfter = now;
          plan.error = null;
          plan.gaps++;
        }
        await this.db
          .prepare(
            "UPDATE copy_agents SET revision=?,status=?,lease=NULL,lease_until=0,body=? WHERE wallet=?",
          )
          .run(plan.revision, plan.status, JSON.stringify(plan), wallet);
        await this.db
          .prepare(
            "UPDATE copy_agent_decisions SET status='dismissed' WHERE plan=? AND status='review'",
          )
          .run(plan.id);
        await this.db.exec("COMMIT");
        return plan;
      } catch (e) {
        await this.db.exec("ROLLBACK");
        throw e;
      }
    });
  }
  async dismiss(wallet: string, decisionId: string) {
    return await this.db.session(async () => {
      const plan = await this.get(wallet);
      if (
        !plan ||
        (
          await this.db
            .prepare(
              "UPDATE copy_agent_decisions SET status='dismissed' WHERE id=? AND plan=? AND status='review'",
            )
            .run(decisionId, plan.id)
        ).changes !== 1
      )
        throw new AppError(
          "PROPOSAL_NOT_FOUND",
          "This proposal is unavailable for your wallet.",
          404,
        );
    });
  }
  async acquire(plan: AgentPlan, now = Date.now()) {
    return await this.db.session(async () => {
      const token = randomUUID();
      const changed = await this.db
        .prepare(
          "UPDATE copy_agents SET lease=?,lease_until=? WHERE id=? AND revision=? AND status='watching' AND expires>? AND lease_until<=?",
        )
        .run(token, now + 300000, plan.id, plan.revision, now, now);
      return changed.changes === 1 ? token : null;
    });
  }
  async release(id: string, token: string) {
    return await this.db.session(async () => {
      await this.db
        .prepare(
          "UPDATE copy_agents SET lease=NULL,lease_until=0 WHERE id=? AND lease=?",
        )
        .run(id, token);
    });
  }
  async commit(
    original: AgentPlan,
    token: string,
    next: AgentPlan,
    decisions: AgentDecision[],
    now = Date.now(),
    poll?: AgentPoll,
  ) {
    return await this.db.session(async () => {
      await this.db.exec("BEGIN IMMEDIATE");
      try {
        const updated = { ...next, revision: original.revision + 1 };
        const changed = await this.db
          .prepare(
            "UPDATE copy_agents SET revision=?,status=?,body=? WHERE id=? AND revision=? AND lease=? AND lease_until>? AND status='watching' AND expires>?",
          )
          .run(
            updated.revision,
            updated.status,
            JSON.stringify(updated),
            original.id,
            original.revision,
            token,
            now,
            now,
          );
        if (changed.changes !== 1) {
          await this.db.exec("ROLLBACK");
          return false;
        }
        if (poll)
          await this.db
            .prepare("INSERT INTO copy_agent_polls VALUES(?,?,?)")
            .run(original.id, updated.revision, JSON.stringify(poll));
        if (decisions.length)
          await this.db.batch(
            decisions.map((d) => ({
              sql: "INSERT OR IGNORE INTO copy_agent_decisions VALUES(?,?,?,?,?,?,?)",
              args: [
                d.id,
                original.id,
                d.sourceId,
                d.status,
                d.expiresAt,
                d.observedAt,
                JSON.stringify(d),
              ],
            })),
          );
        if (updated.status !== "watching")
          await this.db
            .prepare(
              "UPDATE copy_agent_decisions SET status='dismissed' WHERE plan=? AND status='review'",
            )
            .run(original.id);
        await this.db.exec("COMMIT");
        return true;
      } catch (e) {
        await this.db.exec("ROLLBACK");
        throw e;
      }
    });
  }
}
let singleton: AgentStore | undefined;
export function agentStore() {
  return (singleton ??= new AgentStore(
    resolve(
      /* turbopackIgnore: true */ process.env.SHADOW_DB_PATH ??
        "./data/shadow.sqlite",
    ),
  ));
}
