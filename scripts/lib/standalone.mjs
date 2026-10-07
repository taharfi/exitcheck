import { cpSync, existsSync } from "node:fs";
export function prepareStandalone() {
  if (!existsSync(".next/standalone/server.js"))
    throw Error("Run npm run build first.");
  cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
  cpSync("public", ".next/standalone/public", { recursive: true });
}
