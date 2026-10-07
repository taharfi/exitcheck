import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { createClient } from "@libsql/client/web";
import type { Client, Transaction, InValue } from "@libsql/client";

type Scope = { transaction?: Transaction; localTransaction?: boolean };
type Row = Record<string, unknown>;
type LocalQueue = { tail: Promise<void>; references: number };
const localQueues = new Map<string, LocalQueue>();

/** Awaited storage with a transaction context owned by each operation. */
export class AsyncDatabase {
  private readonly context = new AsyncLocalStorage<Scope>();
  private schemas: string[] = [];
  private initialized = 0;
  private initialization: Promise<void> = Promise.resolve();
  constructor(
    private readonly local?: DatabaseSync,
    private readonly remote?: Client,
    private readonly queue: LocalQueue = {
      tail: Promise.resolve(),
      references: 1,
    },
    private readonly releaseConnection?: () => void,
  ) {}
  initialize(sql: string) {
    if (!this.schemas.includes(sql)) this.schemas.push(sql);
    return this;
  }
  private async ready() {
    this.initialization = this.initialization
      .catch(() => undefined)
      .then(async () => {
        while (this.initialized < this.schemas.length) {
          const sql = this.schemas[this.initialized];
          if (this.local) this.local.exec(sql);
          else await this.remote!.executeMultiple(sql);
          this.initialized++;
        }
      });
    await this.initialization;
  }
  async session<T>(work: () => Promise<T>): Promise<T> {
    if (this.context.getStore()) return work();
    await this.ready();
    const scope: Scope = {};
    const run = () =>
      this.context.run(scope, async () => {
        try {
          return await work();
        } finally {
          if (scope.transaction) {
            try {
              await scope.transaction.rollback();
            } finally {
              scope.transaction.close();
              scope.transaction = undefined;
            }
          }
          if (scope.localTransaction) {
            this.local!.exec("ROLLBACK");
            scope.localTransaction = false;
          }
        }
      });
    if (!this.local) return run();
    // Awaiting SQLite permits JS requests to interleave; keep the local
    // connection owned by one session through commit or rollback.
    const previous = this.queue.tail;
    let release!: () => void;
    this.queue.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await run();
    } finally {
      release();
    }
  }
  async exec(sql: string): Promise<void> {
    if (!this.context.getStore()) return this.session(() => this.exec(sql));
    const scope = this.context.getStore()!;
    const command = sql.trim().replace(/;$/, "").toUpperCase();
    if (command === "BEGIN IMMEDIATE") {
      if (scope.transaction || scope.localTransaction)
        throw new Error("Nested transaction");
      if (this.local) {
        this.local.exec(sql);
        scope.localTransaction = true;
      } else scope.transaction = await this.remote!.transaction("write");
    } else if (command === "COMMIT" || command === "ROLLBACK") {
      if (this.local) {
        if (scope.localTransaction) this.local.exec(command);
        scope.localTransaction = false;
      } else if (scope.transaction) {
        const transaction = scope.transaction;
        scope.transaction = undefined;
        try {
          if (command === "COMMIT") await transaction.commit();
          else await transaction.rollback();
        } finally {
          transaction.close();
        }
      }
    } else if (this.local) this.local.exec(sql);
    else if (scope.transaction) await scope.transaction.executeMultiple(sql);
    else await this.remote!.executeMultiple(sql);
  }
  prepare(sql: string) {
    const execute = async (args: SQLInputValue[]) =>
      this.session(async () => {
        if (this.local) {
          const statement = this.local.prepare(sql);
          if (/^\s*(SELECT|WITH|PRAGMA)/i.test(sql))
            return { rows: statement.all(...args) as Row[], changes: 0 };
          const result = statement.run(...args);
          return { rows: [] as Row[], changes: Number(result.changes) };
        }
        const executor = this.context.getStore()?.transaction ?? this.remote!;
        const result = await executor.execute({ sql, args: args as InValue[] });
        return {
          rows: result.rows as unknown as Row[],
          changes: result.rowsAffected,
        };
      });
    return {
      run: async (...args: SQLInputValue[]) => ({
        changes: (await execute(args)).changes,
      }),
      get: async (...args: SQLInputValue[]) => (await execute(args)).rows[0],
      all: async (...args: SQLInputValue[]) => (await execute(args)).rows,
      iterate: async (...args: SQLInputValue[]) => (await execute(args)).rows,
    };
  }
  async batch(statements: { sql: string; args: SQLInputValue[] }[]) {
    return this.session(async () => {
      if (this.local) {
        for (const statement of statements)
          this.local.prepare(statement.sql).run(...statement.args);
      } else {
        const transaction = this.context.getStore()?.transaction;
        const inputs = statements.map(({ sql, args }) => ({
          sql,
          args: args as InValue[],
        }));
        if (transaction) await transaction.batch(inputs);
        else await this.remote!.batch(inputs, "write");
      }
    });
  }
  close() {
    this.local?.close();
    this.remote?.close();
    this.releaseConnection?.();
  }
}

export function openSqlite(path: string) {
  if (process.env.EXITCHECK_DATABASE === "turso" && path !== ":memory:") {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url || !authToken)
      throw new Error("Turso database credentials are required");
    return new AsyncDatabase(undefined, createClient({ url, authToken }));
  }
  if (process.env.VERCEL === "1" && path !== ":memory:")
    throw new Error("Vercel requires persistent remote database configuration");
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  if (path === ":memory:") return new AsyncDatabase(db);
  const queue = localQueues.get(path) ?? {
    tail: Promise.resolve(),
    references: 0,
  };
  queue.references++;
  localQueues.set(path, queue);
  return new AsyncDatabase(db, undefined, queue, () => {
    if (--queue.references === 0) localQueues.delete(path);
  });
}
