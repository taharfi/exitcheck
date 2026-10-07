import type { AsyncDatabase } from "@/lib/server/sqlite";
import { resolve } from "node:path";
import { openSqlite } from "@/lib/server/sqlite";
import { timingSafeEqual, createHash } from "node:crypto";
import type { PreparedAction } from "./types";
import { AppError } from "../../lib/errors";
let database: AsyncDatabase | undefined;
function db() {
  if (database) return database;
  const path = resolve(
    /* turbopackIgnore: true */ process.env.ACTION_DB_PATH ??
      "./data/actions.sqlite",
  );
  database = openSqlite(path);
  database.initialize(`
    CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, position TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS active_position ON actions(owner, position) WHERE status NOT IN ('rejected','failed','cancelled','filled','claimed','expired');`);
  return database;
}
export async function saveAction(action: PreparedAction) {
  await db()
    .prepare(
      "UPDATE actions SET status=?,body=? WHERE id=? AND (status NOT IN ('filled','claimed','rejected','failed','cancelled') OR status=?)",
    )
    .run(action.status, JSON.stringify(action), action.id, action.status);
}
export async function insertAction(action: PreparedAction) {
  try {
    await db()
      .prepare("INSERT INTO actions VALUES(?,?,?,?,?)")
      .run(
        action.id,
        action.owner,
        action.positionId,
        action.status,
        JSON.stringify(action),
      );
  } catch {
    throw new AppError(
      "ACTION_EXISTS",
      "An action already exists for this position. Reconcile it before preparing another.",
      409,
    );
  }
}
export async function getAction(
  id: string,
  token: string,
): Promise<PreparedAction> {
  const row = (await db()
    .prepare("SELECT body FROM actions WHERE id=?")
    .get(id)) as { body: string } | undefined;
  if (!row) throw new AppError("NOT_FOUND", "Action not found.", 404);
  const action = JSON.parse(row.body) as PreparedAction;
  const hash = (s: string) => createHash("sha256").update(s).digest();
  if (!timingSafeEqual(hash(token), hash(action.token)))
    throw new AppError("FORBIDDEN", "Invalid action recovery token.", 403);
  return action;
}
export async function findActive(
  owner: string,
  position: string,
): Promise<PreparedAction | null> {
  const row = (await db()
    .prepare(
      "SELECT body FROM actions WHERE owner=? AND position=? AND status NOT IN ('rejected','failed','cancelled','filled','claimed','expired')",
    )
    .get(owner, position)) as { body: string } | undefined;
  return row ? (JSON.parse(row.body) as PreparedAction) : null;
}
export async function expirePrepared(action: PreparedAction) {
  if (action.status === "prepared" && action.expiresAt < Date.now()) {
    await db()
      .prepare("UPDATE actions SET status=? WHERE id=?")
      .run("expired", action.id);
    return true;
  }
  return false;
}
export async function lockSubmission(id: string): Promise<boolean> {
  return (
    (
      await db()
        .prepare(
          "UPDATE actions SET status='submitting' WHERE id=? AND status='prepared'",
        )
        .run(id)
    ).changes === 1
  );
}
