import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch();
try {
  mkdirSync("docs/screenshots", { recursive: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page
      .getByRole("heading", {
        name: "Know your position. Understand your exit.",
      })
      .waitFor();
    await page.getByRole("button", { name: "25%", exact: true }).click();
    await page.getByText("$16.00", { exact: true }).waitFor();
    await page.getByRole("button", { name: "50%", exact: true }).click();
    await page.getByText("$31.50", { exact: true }).waitFor();
    await page.getByRole("button", { name: "100%", exact: true }).click();
    await page.getByText("$60.50", { exact: true }).waitFor();
    await page.screenshot({
      path: `docs/screenshots/landing-${width}.png`,
      fullPage: true,
    });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      )
    )
      throw new Error(`Landing overflow at ${width}`);
    await page
      .getByRole("link", { name: "Check my positions", exact: true })
      .first()
      .click();
    await page.waitForURL("**/app");
    await page.getByLabel("Wallet address", { exact: true }).waitFor();
    await page
      .getByRole("link", { name: "ExitCheck home", exact: true })
      .click();
    await page.waitForURL(base + "/");
    await page
      .getByRole("heading", {
        name: "Know your position. Understand your exit.",
      })
      .waitFor();
    if (
      (await page.evaluate(
        () => getComputedStyle(document.body).paddingLeft,
      )) !== "0px"
    )
      throw new Error("App sidebar spacing leaked onto the landing page.");
    await page
      .locator("summary")
      .filter({ hasText: "Does ExitCheck automatically trade for me?" })
      .click();
    await page
      .getByText(/No\. This version focuses on position lookup/)
      .waitFor();
    await page
      .getByRole("link", { name: "Explore research tools", exact: true })
      .click();
    await page.waitForURL("**/research");
    await page.getByLabel("Virtual budget (USD)").waitFor();
    if (errors.length) throw new Error(errors.join("\n"));
    await page.close();
  }
  console.log(
    "Landing example, FAQ, app entry, home return and research entry passed at 1440px and 390px.",
  );
} finally {
  await browser.close();
}
