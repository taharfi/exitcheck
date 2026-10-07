import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const base = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const response = await fetch(`${base}/api/health`);
const health = await response.json();
if (health.mode !== "production")
  throw new Error("Production smoke check must not use fixtures.");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  const navigation = await page.goto(base + "/exit");
  if (navigation?.status() !== 200)
    throw new Error("Production page did not load.");
  await page.getByRole("heading", { name: "Know what comes back." }).waitFor();
  if (response.status === 503) {
    await page.getByText("Provider setup required", { exact: true }).waitFor();
    const lookup = await fetch(
      `${base}/api/positions?owner=11111111111111111111111111111111`,
    );
    const result = await lookup.json();
    if (lookup.status !== 503 || result.error?.code !== "SETUP_REQUIRED")
      throw new Error(
        "Unconfigured production must block position lookup without fixture fallback.",
      );
  }
  if (await page.getByText("Development fixtures", { exact: true }).count())
    throw new Error("Production displayed development fixtures.");
  const font = await fetch(`${base}/fonts/dm-sans.ttf`);
  if (!font.ok) throw new Error("Self-hosted font was not served.");
  mkdirSync("docs/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/production-setup.png",
    fullPage: true,
  });
  console.log(
    JSON.stringify({
      productionPage: 200,
      health: response.status,
      mode: health.mode,
      fixtureFallback: false,
      fontAssets: "served",
      financialExecution: "not attempted",
    }),
  );
} finally {
  await browser.close();
}
