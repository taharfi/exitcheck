import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { openSqlite } from "../../src/lib/server/sqlite";

it("isolates concurrent local transactions across connections to the same file", async () => {
  const path = `./test-results/database-${randomUUID()}.sqlite`;
  const first = openSqlite(path),
    second = openSqlite(path);
  first.initialize("CREATE TABLE records(id INTEGER PRIMARY KEY, value TEXT)");
  second.initialize(
    "CREATE TABLE IF NOT EXISTS records(id INTEGER PRIMARY KEY, value TEXT)",
  );
  try {
    await Promise.all([
      first.session(async () => {
        await first.exec("BEGIN IMMEDIATE");
        await first.prepare("INSERT INTO records VALUES(1,?)").run("committed");
        await Promise.resolve();
        await first.exec("COMMIT");
      }),
      second.session(async () => {
        await second.exec("BEGIN IMMEDIATE");
        await second
          .prepare("INSERT INTO records VALUES(2,?)")
          .run("rolled back");
        await second.exec("ROLLBACK");
      }),
    ]);
    expect(
      await first.prepare("SELECT * FROM records ORDER BY id").all(),
    ).toEqual([{ id: 1, value: "committed" }]);
  } finally {
    first.close();
    second.close();
  }
});

it("rolls back a batch if a later write fails, without keeping the connection locked", async () => {
  const db = openSqlite(":memory:");
  db.initialize("CREATE TABLE records(id INTEGER PRIMARY KEY)");
  try {
    await expect(
      db.session(async () => {
        await db.exec("BEGIN IMMEDIATE");
        await db.batch([
          { sql: "INSERT INTO records VALUES(?)", args: [1] },
          { sql: "INSERT INTO records VALUES(?)", args: [1] },
        ]);
        await db.exec("COMMIT");
      }),
    ).rejects.toThrow();
    expect(await db.prepare("SELECT * FROM records").all()).toEqual([]);
    await db.prepare("INSERT INTO records VALUES(?)").run(2);
    expect(await db.prepare("SELECT * FROM records").all()).toEqual([
      { id: 2 },
    ]);
  } finally {
    db.close();
  }
});

it("refuses local persistence on Vercel and missing remote credentials", () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("EXITCHECK_DATABASE", "sqlite");
  try {
    expect(() => openSqlite("unused.sqlite")).toThrow("persistent remote");
  } finally {
    vi.unstubAllEnvs();
  }
  vi.stubEnv("EXITCHECK_DATABASE", "turso");
  vi.stubEnv("TURSO_DATABASE_URL", "");
  try {
    expect(() => openSqlite("unused.sqlite")).toThrow("credentials");
  } finally {
    vi.unstubAllEnvs();
  }
});
