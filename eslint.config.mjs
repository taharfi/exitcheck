import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".vercel/**",
    ".agents/**",
    "src/app/.well-known/workflow/**",
    "next-env.d.ts",
    "docs/provider-source/**",
    "test-results/",
    "playwright-report/",
    "data/",
  ]),
]);
