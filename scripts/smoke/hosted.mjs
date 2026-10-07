import { chromium, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
const base = "https://exitcheck.xyz";
const browser = await chromium.launch();
try {
  mkdirSync("docs/screenshots", { recursive: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const home = await page.goto(base, { waitUntil: "networkidle" });
    expect(home.status()).toBe(200);
    await expect(page).toHaveTitle(/ExitCheck/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `docs/screenshots/hosted-home-${width}.png`, fullPage: true });
    await page.goto(base + "/agent", { waitUntil: "networkidle" });
    await page.getByLabel("Trader wallet", { exact: true }).fill("DVHD66wYT5wFcgJ9K2SbtJTmbsJxzz6chkAzNwzbksdT");
    const response = page.waitForResponse((r) => r.url().includes("/api/agent/trader?"), { timeout: 35000 });
    await page.getByRole("button", { name: "Check trader activity", exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(page.getByText("Last sampled fill", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `docs/screenshots/hosted-agent-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
    await page.close();
    console.log(`Hosted ${width}px: HTTPS landing, public trader history, responsive layout and browser runtime passed. No mocks, wallet signatures or transactions.`);
  }
} finally { await browser.close(); }
