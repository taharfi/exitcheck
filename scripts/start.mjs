import { prepareStandalone } from "./lib/standalone.mjs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd(), false);
prepareStandalone();
const child = spawn(process.execPath, [".next/standalone/server.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: process.env.HOSTNAME ?? "0.0.0.0",
    PORT: process.env.PORT ?? "3000",
    SHADOW_COLLECTOR_ENABLED: process.env.SHADOW_COLLECTOR_ENABLED ?? "true",
    MARKET_RECORDER_ENABLED: process.env.MARKET_RECORDER_ENABLED ?? "true",
    AGENT_COLLECTOR_ENABLED: process.env.AGENT_COLLECTOR_ENABLED ?? "true",
    SHADOW_DB_PATH: resolve(
      process.env.SHADOW_DB_PATH ?? "./data/shadow.sqlite",
    ),
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
