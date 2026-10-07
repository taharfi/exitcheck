import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const base = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch();
try {
  mkdirSync("docs/screenshots", { recursive: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + "/research");
    await page.getByRole("heading", { name: "Would copying them work for you?" }).waitFor();
    await page.screenshot({ path: `docs/screenshots/product-${width}.png`, fullPage: true });
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error(`Overview overflow at ${width}`);
    await page.getByRole("button", { name: "$500", exact: true }).click();
    await page.locator(".overview-budget").getByRole("link", { name: "Test my budget" }).click();
    await page.waitForURL("**/compare?budget=500");
    await page.waitForFunction(() => document.querySelector('input[value="500"]'));
    await page.getByRole("link", { name: "Advanced tools", exact: true }).click();
    await page.waitForURL("**/lab");
    await page.getByRole("heading", { name: "Market signal research" }).waitFor();
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error(`Advanced tools overflow at ${width}`);
    if (errors.length) throw new Error(errors.join("\n"));
    await page.close();
  }
  console.log("Product overview, budget handoff and advanced navigation passed at 1440px and 390px.");
} finally {
  await browser.close();
}
