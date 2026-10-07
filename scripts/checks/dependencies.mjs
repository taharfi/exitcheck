import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
if (!process.env.npm_execpath)
  throw Error("Run this check with npm run audit:dependencies.");
const child = spawn(
  process.execPath,
  [process.env.npm_execpath, "audit", "--json"],
  { stdio: ["ignore", "pipe", "inherit"] },
);
let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk;
});
const code = await new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("exit", resolve);
});
let report;
try {
  report = JSON.parse(output);
} catch {
  throw Error("npm audit did not return a valid report.");
}
mkdirSync("docs/audits", { recursive: true });
writeFileSync(
  "docs/audits/dependencies.json",
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      installPolicy:
        "omit=peer; required runtime peers are direct dependencies",
      ...report,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(report.metadata?.vulnerabilities ?? report.error, null, 2),
);
console.log("Full report saved to docs/audits/dependencies.json");
process.exitCode = Number(code) || 0;
