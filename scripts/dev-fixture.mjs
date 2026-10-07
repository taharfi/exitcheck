import { spawn } from "node:child_process";
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    process.env.PORT ?? "3001",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      EXITCHECK_MODE: "fixture",
      SHADOW_COLLECTOR_ENABLED: "false",
      MARKET_RECORDER_ENABLED: "false",
      AGENT_COLLECTOR_ENABLED: "false",
      ACTION_DB_PATH: "./test-results/fixture-actions.sqlite",
      SHADOW_DB_PATH: "./test-results/fixture-research.sqlite",
      APP_ORIGIN: `http://127.0.0.1:${process.env.PORT ?? "3001"}`,
    },
  },
);
child.on("exit", (code) => process.exit(code ?? 0));
