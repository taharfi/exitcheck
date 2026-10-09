import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const markers = [
  `exitcheck_build_key_${randomBytes(24).toString("hex")}`,
  `https://exitcheck-build-rpc-${randomBytes(12).toString("hex")}.invalid`,
  `exitcheck_build_gemini_${randomBytes(24).toString("hex")}`,
];
markers.push(`exitcheck_build_deepseek_${randomBytes(24).toString("hex")}`);
markers.push(`exitcheck_build_panta_${randomBytes(24).toString("hex")}`);
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "build"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      JUPITER_API_KEY: markers[0],
      PANTA_API_KEY: markers[4],
      SOLANA_RPC_URL: markers[1],
      DEEPSEEK_API_KEY: markers[3],
      GEMINI_API_KEY: markers[2],
      GEMINI_API_KEY_1: markers[2] + "_one",
      GEMINI_API_KEY_2: markers[2] + "_two",
      GEMINI_API_KEY_3: markers[2] + "_three",
    },
  },
);
const code = await new Promise((resolve) => child.on("exit", resolve));
if (code !== 0) process.exit(Number(code) || 1);
let files = 0;
function scan(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) scan(file);
    else {
      files++;
      const content = readFileSync(file).toString("utf8");
      if (markers.some((marker) => content.includes(marker)))
        throw new Error(
          "A server-only test credential appeared in public build assets. Release blocked.",
        );
    }
  }
}
scan(".next/static");
console.log(
  `Client secret boundary passed: ${files} public build files inspected using nonsecret build sentinels.`,
);
