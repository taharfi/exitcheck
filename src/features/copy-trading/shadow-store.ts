import type { AsyncDatabase } from "@/lib/server/sqlite";
import { resolve } from "node:path";
import { openSqlite } from "@/lib/server/sqlite";
import { createHash, randomUUID } from "node:crypto";
import { paperSchema, type Paper, type Trade, type Quote } from "./paper";
import { AppError } from "../../lib/errors";
export type Shadow = {
  id: string;
  session: string;
  revision: number;
  paper: Paper;
  createdAt: number;
  acceptAfter: number;
  expiresAt: number;
  lastPoll: number | null;
  lastSuccess: number | null;
  error: string | null;
  gaps: number;
  polls: number;
};
export type Observation = {
  trade: Trade;
  quote: Quote | null;
  observedAt: number;
  delayMs: number;
  premiumBps: string | null;
};
export class ShadowStore {
  readonly db: AsyncDatabase;
  constructor(path: string) {
    this.db = openSqlite(path);
    this.db.initialize(`
      CREATE TABLE IF NOT EXISTS shadow_portfolios(id TEXT PRIMARY KEY, session TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL, expires INTEGER NOT NULL, paused INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS shadow_observations(owner TEXT NOT NULL,id TEXT NOT NULL,at INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner,id));
      CREATE TABLE IF NOT EXISTS shadow_lease(id INTEGER PRIMARY KEY CHECK(id=1),token TEXT NOT NULL,until INTEGER NOT NULL);`);
  }
  async get(session: string): Promise<Shadow | null> {
    return await this.db.session(async () => {
      const row = (await this.db
        .prepare("SELECT body FROM shadow_portfolios WHERE session=?")
        .get(session)) as { body: string } | undefined;
      return row ? (JSON.parse(row.body) as Shadow) : null;
    });
  }
  async create(session: string, paper: Paper, now = Date.now()) {
    return await this.db.session(async () => {
      await this.db.exec("BEGIN IMMEDIATE");
      try {
        const existing = await this.get(session);
        if (existing && existing.expiresAt > now)
          throw new AppError(
            "SHADOW_EXISTS",
            "A background portfolio already exists. Stop it before starting another.",
            409,
          );
        const count = (await this.db
          .prepare(
            "SELECT count(*) AS n FROM shadow_portfolios WHERE expires>? AND paused=0",
          )
          .get(now)) as { n: number };
        if (count.n >= 25)
          throw new AppError(
            "SHADOW_CAPACITY",
            "This server is monitoring 25 portfolios. Try again later.",
            429,
          );
        const row: Shadow = {
          id: randomUUID(),
          session,
          revision: 0,
          paper: paperSchema.parse(paper),
          createdAt: now,
          acceptAfter: now,
          expiresAt: now + 7 * 86400000,
          lastPoll: null,
          lastSuccess: null,
          error: null,
          gaps: 0,
          polls: 0,
        };
        await this.db
          .prepare("DELETE FROM shadow_portfolios WHERE session=?")
          .run(session);
        await this.db
          .prepare("INSERT INTO shadow_portfolios VALUES(?,?,?,?,?,?)")
          .run(row.id, session, 0, row.expiresAt, 0, JSON.stringify(row));
        await this.db.exec("COMMIT");
        return row;
      } catch (e) {
        await this.db.exec("ROLLBACK");
        throw e;
      }
    });
  }
  async active(now = Date.now()): Promise<Shadow[]> {
    return await this.db.session(async () => {
      return (
        (await this.db
          .prepare(
            "SELECT body FROM shadow_portfolios WHERE expires>? AND paused=0",
          )
          .all(now)) as { body: string }[]
      ).map((x) => JSON.parse(x.body));
    });
  }
  async save(row: Shadow) {
    return await this.db.session(async () => {
      const next = { ...row, revision: row.revision + 1 };
      return (
        (
          await this.db
            .prepare(
              "UPDATE shadow_portfolios SET revision=?,paused=?,body=? WHERE id=? AND revision=?",
            )
            .run(
              next.revision,
              next.paper.paused ? 1 : 0,
              JSON.stringify(next),
              row.id,
              row.revision,
            )
        ).changes === 1
      );
    });
  }
  async remove(session: string) {
    return await this.db.session(async () => {
      await this.db
        .prepare("DELETE FROM shadow_portfolios WHERE session=?")
        .run(session);
    });
  }
  async linkGuest(guest: string, walletKey: string, now = Date.now()) {
    return await this.db.session(async () => {
      await this.db.exec("BEGIN IMMEDIATE");
      try {
        const row = await this.get(guest),
          existing = await this.get(walletKey);
        if (!row || row.expiresAt <= now || existing) {
          await this.db.exec("COMMIT");
          return false;
        }
        row.session = walletKey;
        row.revision++;
        await this.db
          .prepare(
            "UPDATE shadow_portfolios SET session=?,revision=?,body=? WHERE id=?",
          )
          .run(walletKey, row.revision, JSON.stringify(row), row.id);
        await this.db.exec("COMMIT");
        return true;
      } catch (e) {
        await this.db.exec("ROLLBACK");
        throw e;
      }
    });
  }
  async acquire(now = Date.now()): Promise<string | null> {
    return await this.db.session(async () => {
      const token = randomUUID();
      const r = await this.db
        .prepare(
          "INSERT INTO shadow_lease VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,until=excluded.until WHERE shadow_lease.until<?",
        )
        .run(token, now + 300000, now);
      return r.changes === 1 ? token : null;
    });
  }
  async release(token: string) {
    return await this.db.session(async () => {
      await this.db
        .prepare("DELETE FROM shadow_lease WHERE token=?")
        .run(token);
    });
  }
  async observe(row: Observation) {
    return await this.db.session(async () => {
      await this.db
        .prepare("INSERT OR IGNORE INTO shadow_observations VALUES(?,?,?,?)")
        .run(
          row.trade.ownerPubkey,
          row.trade.id,
          row.observedAt,
          JSON.stringify(row),
        );
    });
  }
  async observations(owner: string): Promise<Observation[]> {
    return await this.db.session(async () => {
      return (
        (await this.db
          .prepare(
            "SELECT body FROM shadow_observations WHERE owner=? ORDER BY at DESC LIMIT 300",
          )
          .all(owner)) as { body: string }[]
      ).map((x) => JSON.parse(x.body));
    });
  }
  async prune(now = Date.now()) {
    return await this.db.session(async () => {
      await this.db
        .prepare("DELETE FROM shadow_observations WHERE at<?")
        .run(now - 30 * 86400000);
      await this.db
        .prepare("DELETE FROM shadow_portfolios WHERE expires<?")
        .run(now - 7 * 86400000);
    });
  }
}
let singleton: ShadowStore | undefined;
export function shadowStore() {
  return (singleton ??= new ShadowStore(
    resolve(
      /* turbopackIgnore: true */ process.env.SHADOW_DB_PATH ??
        "./data/shadow.sqlite",
    ),
  ));
}
export function sessionHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function publicShadow(row: Shadow | null) {
  if (!row) return null;
  const { session: _session, ...safe } = row;
  void _session;
  return safe;
}
