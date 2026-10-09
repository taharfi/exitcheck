import { spawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { prepareStandalone } from "../lib/standalone.mjs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
prepareStandalone();
const directory = mkdtempSync(join(tmpdir(), "exitcheck-smoke-")),
  origin = "http://127.0.0.1:3030";
const environment = {
  ...process.env,
  NODE_ENV: "production",
  HOSTNAME: "127.0.0.1",
  PORT: "3030",
  APP_ORIGIN: origin,
  EXITCHECK_MODE: "production",
  EXITCHECK_DATABASE: "sqlite",
  MONITORING_WORKFLOW_ENABLED: "false",
  VERCEL: "",
  JUPITER_API_KEY: "",
  DEEPSEEK_API_KEY: "",
  RESEARCH_PROVIDER: "gemini",
  GEMINI_API_KEY: "",
  GEMINI_API_KEY_1: "",
  GEMINI_API_KEY_2: "",
  GEMINI_API_KEY_3: "",
  SOLANA_RPC_URL: "",
  ENABLE_LIVE_EXECUTION: "false",
  ALLOWED_PROGRAM_IDS: "",
  SHADOW_COLLECTOR_ENABLED: "true",
  MARKET_RECORDER_ENABLED: "false",
  AGENT_COLLECTOR_ENABLED: "false",
  ACTION_DB_PATH: join(directory, "actions.sqlite"),
  SHADOW_DB_PATH: join(directory, "research.sqlite"),
  SMOKE_LIVE_READS: "false",
  SHADOW_UI_ONLY: "true",
};
for (const name of [
  "ACCOUNT",
  "BACKTEST",
  "COMPARE",
  "DISCOVER",
  "PAPER",
  "SHADOW",
])
  environment[`${name}_BASE_URL`] = origin;
environment.TEST_ORIGIN = origin;
environment.SMOKE_BASE_URL = origin;
const server = spawn(process.execPath, [".next/standalone/server.js"], {
  env: environment,
  stdio: "inherit",
});
let exited = false;
server.on("exit", () => {
  exited = true;
});
const closed = new Promise((resolve) => server.on("close", resolve));
try {
  const deadline = Date.now() + 60000;
  let ready = false;
  let lastHealth = "No response received";
  while (Date.now() < deadline && !exited) {
    try {
      const r = await fetch(origin + "/api/health", {
        signal: AbortSignal.timeout(2500),
      });
      if ([200, 503].includes(r.status)) {
        ready = true;
        break;
      }
      lastHealth = `HTTP ${r.status}`;
    } catch (error) {
      lastHealth = error instanceof Error ? error.name : "Request failed";
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready || exited)
    throw Error(
      `Isolated smoke server could not start on port 3030 within 60 seconds (${lastHealth}).`,
    );
  for (const name of [
    "production",
    "landing",
    "agent",
    "product",
    "discover",
    "compare",
    "paper",
    "backtest",
    "shadow",
    "account",
    "bot",
  ]) {
    console.log(`Checking ${name} against isolated SQLite databases…`);
    const child = spawn(process.execPath, [`scripts/smoke/${name}.mjs`], {
      env: environment,
      stdio: "inherit",
    });
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", resolve);
    });
    if (code !== 0) throw Error(`${name} smoke check failed.`);
  }
  console.log(
    "All smoke checks passed. No user database, credentials, or funded execution were used.",
  );
} finally {
  server.kill();
  await closed;
  const target = realpathSync(directory),
    parent = realpathSync(tmpdir());
  if (
    dirname(target) !== parent ||
    !target.split(/[\\/]/).at(-1).startsWith("exitcheck-smoke-")
  )
    throw Error("Refusing to remove an unexpected temporary path.");
  rmSync(target, { recursive: true, force: true });
}
