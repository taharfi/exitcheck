import { chromium, expect } from "@playwright/test";
import nacl from "tweetnacl";
import bs58 from "bs58";
import assert from "node:assert/strict";
const base = process.env.ACCOUNT_BASE_URL ?? "http://127.0.0.1:3000";
const keys = [nacl.sign.keyPair(), nacl.sign.keyPair()];
const browser = await chromium.launch();
let clientNumber = 10;
async function contextFor(width, index = 0, rejectFirst = false, options = {}) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    // Independent simulated clients must not share one artificial loopback bucket.
    extraHTTPHeaders: { "X-Forwarded-For": `198.51.100.${clientNumber++}` },
  });
  let rejected = false,
    transactions = 0;
  await context.exposeFunction("testSign", (bytes) => {
    if (rejectFirst && !rejected) {
      rejected = true;
      throw Error("User rejected login message");
    }
    return Array.from(
      nacl.sign.detached(Uint8Array.from(bytes), keys[index].secretKey),
    );
  });
  await context.exposeFunction("testTransaction", () => {
    transactions++;
    throw Error("Transactions forbidden in account test");
  });
  await context.addInitScript(
    ({ address, publicKey, phantom, stallFirst }) => {
      const listeners = new Set(),
        account = {
          address,
          publicKey: Uint8Array.from(publicKey),
          chains: ["solana:mainnet"],
          features: ["solana:signMessage", "solana:signTransaction"],
        };
      let accounts = [];
      let signCalls = 0;
      window.phantomSignCount = 0;
      window.standardSignCount = 0;
      const sign = async (message) => {
        signCalls++;
        if (stallFirst && signCalls === 1)
          await new Promise((resolve) => {
            window.releasePendingSign = resolve;
          });
        return Uint8Array.from(await window.testSign(Array.from(message)));
      };
      if (phantom)
        window.phantom = {
          solana: {
            isPhantom: true,
            get isConnected() {
              return accounts.length > 0;
            },
            get publicKey() {
              return accounts.length ? { toBase58: () => address } : null;
            },
            signMessage: async (message, display) => {
              if (display !== "utf8")
                throw Error("Expected UTF-8 message signing");
              window.phantomSignCount++;
              return {
                signature: await sign(message),
              };
            },
          },
        };
      const wallet = {
        version: "1.0.0",
        name: phantom ? "Phantom" : "ExitCheck test wallet",
        icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
        chains: ["solana:mainnet"],
        get accounts() {
          return accounts;
        },
        features: {
          "standard:connect": {
            version: "1.0.0",
            connect: async () => {
              accounts = [account];
              listeners.forEach((fn) => fn({ accounts }));
              return { accounts };
            },
          },
          "standard:disconnect": {
            version: "1.0.0",
            disconnect: async () => {
              accounts = [];
              listeners.forEach((fn) => fn({ accounts }));
            },
          },
          "standard:events": {
            version: "1.0.0",
            on: (_event, fn) => {
              listeners.add(fn);
              return () => listeners.delete(fn);
            },
          },
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy", 0],
            signTransaction: () => window.testTransaction(),
          },
          "solana:signMessage": {
            version: "1.0.0",
            signMessage: async (...inputs) =>
              Promise.all(
                inputs.map(async (input) => {
                  window.standardSignCount++;
                  return {
                    signedMessage: input.message,
                    signature: await sign(input.message),
                  };
                }),
              ),
          },
        },
      };
      window.testDisconnect = () =>
        wallet.features["standard:disconnect"].disconnect();
      window.addEventListener("wallet-standard:app-ready", (e) =>
        e.detail.register(wallet),
      );
      window.dispatchEvent(
        new CustomEvent("wallet-standard:register-wallet", {
          detail: (api) => api.register(wallet),
        }),
      );
    },
    {
      address: bs58.encode(keys[index].publicKey),
      publicKey: Array.from(keys[index].publicKey),
      phantom: options.phantom ?? false,
      stallFirst: options.stallFirst ?? false,
    },
  );
  await context.route("**/api/discover?*", (route) =>
    route.fulfill({ json: { traders: [] } }),
  );
  return { context, transactions: () => transactions };
}
async function connect(page, name = /ExitCheck test wallet/) {
  await page.getByRole("region", { name: "User account" }).waitFor();
  await page
    .getByRole("button", { name: /Select Wallet|Connect Wallet/i })
    .click();
  await page.getByRole("button", { name }).click();
  await page.getByRole("button", { name: "Sign in with wallet" }).waitFor();
}
try {
  for (const width of [1440, 390]) {
    const first = await contextFor(width, 0, true),
      page = await first.context.newPage(),
      errors = [];
    page.on("pageerror", (e) => {
      errors.push(e.message);
      console.log("Browser error:", e.message);
    });
    const created = await first.context.request.post(base + "/api/shadow", {
      headers: { Origin: base },
      data: {
        action: "start",
        owners: [bs58.encode(keys[0].publicKey)],
        budget: "100000000",
      },
    });
    assert.equal(created.status(), 200);
    const id = (await created.json()).portfolio.id;
    await page.goto(base + "/shadow");
    await connect(page);
    await page.getByRole("button", { name: "Sign in with wallet" }).click();
    await expect(
      page.getByRole("region", { name: "User account" }).getByRole("alert"),
    ).toContainText("User rejected");
    assert.equal(
      (await (await first.context.request.get(base + "/api/auth")).json()).user,
      null,
    );
    await page.getByRole("button", { name: "Sign in with wallet" }).click();
    await page.getByRole("button", { name: "Sign out & disconnect" }).waitFor();
    assert.equal(
      (await (await first.context.request.get(base + "/api/shadow")).json())
        .portfolio.id,
      id,
    );
    await page.reload();
    await page.getByRole("button", { name: "Sign out & disconnect" }).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: `docs/screenshots/account-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Sign out & disconnect" }).click();
    await expect
      .poll(
        async () =>
          (await (await first.context.request.get(base + "/api/auth")).json())
            .user,
      )
      .toBeNull();
    assert.equal(
      (await (await first.context.request.get(base + "/api/shadow")).json())
        .portfolio,
      null,
    );
    const second = await contextFor(width),
      secondPage = await second.context.newPage();
    await secondPage.goto(base + "/shadow");
    await connect(secondPage);
    await secondPage
      .getByRole("button", { name: "Sign in with wallet" })
      .click();
    await secondPage
      .getByRole("button", { name: "Sign out & disconnect" })
      .waitFor();
    assert.equal(
      (await (await second.context.request.get(base + "/api/shadow")).json())
        .portfolio.id,
      id,
    );
    const other = await contextFor(width, 1),
      otherPage = await other.context.newPage();
    await otherPage.goto(base + "/shadow");
    await connect(otherPage);
    await otherPage
      .getByRole("button", { name: "Sign in with wallet" })
      .click();
    await otherPage
      .getByRole("button", { name: "Sign out & disconnect" })
      .waitFor();
    assert.equal(
      (await (await other.context.request.get(base + "/api/shadow")).json())
        .portfolio,
      null,
    );
    await otherPage.evaluate(() => window.testDisconnect());
    await expect
      .poll(
        async () =>
          (await (await other.context.request.get(base + "/api/auth")).json())
            .user,
      )
      .toBeNull();
    assert.equal(
      (
        await second.context.request.post(base + "/api/shadow", {
          headers: { Origin: base },
          data: { action: "stop" },
        })
      ).status(),
      200,
    );
    await secondPage
      .getByRole("button", { name: "Sign out & disconnect" })
      .click();
    assert.deepEqual(errors, []);
    assert.equal(
      first.transactions() + second.transactions() + other.transactions(),
      0,
    );
    await Promise.all([
      first.context.close(),
      second.context.close(),
      other.context.close(),
    ]);
    console.log(
      `Account workflow passed at ${width}px: wallet connect, rejected message, verified sign-in, guest linking, reload, cross-browser recovery, wallet isolation, disconnect and no transactions.`,
    );
    const pending = await contextFor(width, 0, false, {
      phantom: true,
      stallFirst: true,
    });
    const pendingPage = await pending.context.newPage();
    let verifications = 0;
    pendingPage.on("request", (request) => {
      if (
        request.url().endsWith("/api/auth") &&
        request.method() === "POST" &&
        request.postDataJSON()?.action === "verify"
      )
        verifications++;
    });
    await pendingPage.goto(base + "/agent");
    await connect(pendingPage, /Phantom/);
    await pendingPage
      .getByRole("button", { name: "Sign in with wallet" })
      .click();
    await expect(
      pendingPage.getByRole("button", {
        name: "Waiting for wallet approval...",
        exact: true,
      }),
    ).toBeVisible();
    await pendingPage
      .getByRole("button", { name: "Cancel sign-in", exact: true })
      .click();
    await expect(
      pendingPage
        .getByRole("region", { name: "User account" })
        .getByRole("alert"),
    ).toContainText("Sign-in cancelled");
    await pendingPage.evaluate(() => window.releasePendingSign());
    assert.equal(verifications, 0);
    await pendingPage
      .getByRole("button", { name: "Sign in with wallet" })
      .click();
    await expect(
      pendingPage.getByRole("button", {
        name: "Sign out & disconnect",
        exact: true,
      }),
    ).toBeVisible();
    assert.equal(verifications, 1);
    assert.deepEqual(
      await pendingPage.evaluate(() => ({
        phantom: window.phantomSignCount,
        standard: window.standardSignCount,
      })),
      { phantom: 2, standard: 0 },
    );
    assert.equal(
      (await (await pending.context.request.get(base + "/api/auth")).json())
        .user.wallet,
      bs58.encode(keys[0].publicKey),
    );
    await pendingPage.reload();
    await expect(
      pendingPage.getByRole("button", {
        name: "Sign out & disconnect",
        exact: true,
      }),
    ).toBeVisible();
    await pendingPage
      .getByRole("button", { name: "Sign out & disconnect", exact: true })
      .click();
    assert.equal(pending.transactions(), 0);
    await pending.context.close();

    const missing = await contextFor(width, 0, false, { phantom: true });
    let signatureVerified = false;
    await missing.context.route("**/api/auth", async (route) => {
      const request = route.request();
      if (request.method() === "GET" && signatureVerified) {
        await route.fulfill({ json: { user: null } });
      } else {
        if (
          request.method() === "POST" &&
          request.postDataJSON()?.action === "verify"
        )
          signatureVerified = true;
        await route.continue();
      }
    });
    const missingPage = await missing.context.newPage();
    await missingPage.goto(base + "/agent");
    await connect(missingPage, /Phantom/);
    await missingPage
      .getByRole("button", { name: "Sign in with wallet" })
      .click();
    await expect(
      missingPage
        .getByRole("region", { name: "User account" })
        .getByRole("alert"),
    ).toContainText("did not retain the login session");
    await expect(
      missingPage.getByRole("button", {
        name: "Sign in with wallet",
        exact: true,
      }),
    ).toBeEnabled();
    await missing.context.request.post(base + "/api/auth", {
      headers: { Origin: base },
      data: { action: "logout" },
    });
    assert.equal(missing.transactions(), 0);
    await missing.context.close();
    console.log(
      `Login recovery passed at ${width}px: simulated Phantom UTF-8 bridge, pending approval cancellation, ignored late result, retry, real session persistence and explicit missing-session error. No extension or funded transaction used.`,
    );
  }
} finally {
  await browser.close();
}
