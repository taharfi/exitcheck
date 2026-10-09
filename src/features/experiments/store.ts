import { shadowStore } from "@/features/copy-trading/shadow-store";
import type { Experiment } from "./engine";
export function experimentDB() {
  return shadowStore().db.initialize(
    `CREATE TABLE IF NOT EXISTS paper_experiments(id TEXT PRIMARY KEY,wallet TEXT NOT NULL,body TEXT NOT NULL);CREATE INDEX IF NOT EXISTS paper_experiments_wallet ON paper_experiments(wallet); CREATE TABLE IF NOT EXISTS experiment_observations(id INTEGER PRIMARY KEY,experiment TEXT NOT NULL,at INTEGER NOT NULL,body TEXT NOT NULL);`,
  );
}
export async function experiments(wallet: string): Promise<Experiment[]> {
  const rows = await experimentDB()
    .prepare(
      "SELECT body FROM paper_experiments WHERE wallet=? ORDER BY rowid DESC LIMIT 20",
    )
    .all(wallet);
  return rows.map((r) => JSON.parse(String(r.body)) as Experiment);
}
