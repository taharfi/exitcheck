import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  ShadowStore,
  sessionHash,
} from "../../src/features/copy-trading/shadow-store";
import { AuthStore, sessionCookie } from "../../src/features/account/auth";
import { startPaper } from "../../src/features/copy-trading/paper";
const now = 1800000000000,
  origin = "http://127.0.0.1:3000";
let store: ShadowStore, auth: AuthStore;
const pair = nacl.sign.keyPair(),
  wallet = bs58.encode(pair.publicKey);
const sign = (message: string, key = pair.secretKey) =>
  bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), key));
beforeEach(() => {
  store = new ShadowStore(":memory:");
  auth = new AuthStore(store);
});
afterEach(() => {
  store.db.close();
  vi.unstubAllEnvs();
});
it("sets Secure using the configured public HTTPS origin behind an HTTP proxy", () => {
  vi.stubEnv("APP_ORIGIN", "https://exitcheck.example");
  expect(
    sessionCookie(
      new Request("http://internal:3000/api/auth"),
      "account",
      "value",
      60,
    ),
  ).toContain("; Secure");
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
  expect(
    sessionCookie(
      new Request("http://127.0.0.1:3000/api/auth"),
      "account",
      "value",
      60,
    ),
  ).not.toContain("; Secure");
});
describe("wallet sign-in", () => {
  it("verifies domain-bound proof, persists a private session and rejects replay", async () => {
    const challenge = await auth.challenge(wallet, origin, now);
    expect(challenge.message).toContain(origin);
    expect(challenge.message).toContain("does not authorize transactions");
    const session = await auth.verify(
      challenge.token,
      sign(challenge.message),
      origin,
      now,
    );
    expect((await auth.user(session.token, now))?.wallet).toBe(wallet);
    expect(await auth.user("forged", now)).toBeNull();
    await expect(
      auth.verify(challenge.token, sign(challenge.message), origin, now),
    ).rejects.toThrow();
    const row = (await store.db
      .prepare("SELECT id FROM login_sessions")
      .get()) as {
      id: string;
    };
    expect(row.id).not.toBe(session.token);
  });
  it("rejects wrong keys, altered messages and changed origins", async () => {
    const c = await auth.challenge(wallet, origin, now);
    await expect(
      auth.verify(
        c.token,
        sign(c.message, nacl.sign.keyPair().secretKey),
        origin,
        now,
      ),
    ).rejects.toThrow("signature");
    await expect(
      auth.verify(c.token, sign(c.message + "!"), origin, now),
    ).rejects.toThrow("signature");
    await expect(
      auth.verify(c.token, sign(c.message), "https://other.example", now),
    ).rejects.toThrow();
  });
  it("expires challenges and sessions, and revokes only the signed-out session", async () => {
    const c = await auth.challenge(wallet, origin, now);
    await expect(
      auth.verify(c.token, sign(c.message), origin, now + 300000),
    ).rejects.toThrow("expired");
    const first = await auth.challenge(wallet, origin, now),
      s1 = await auth.verify(first.token, sign(first.message), origin, now);
    const second = await auth.challenge(wallet, origin, now),
      s2 = await auth.verify(second.token, sign(second.message), origin, now);
    await auth.revoke(s1.token);
    expect(await auth.user(s1.token, now)).toBeNull();
    expect((await auth.user(s2.token, now))?.wallet).toBe(wallet);
    expect(await auth.user(s2.token, now + 86400000)).toBeNull();
  });
  it("links guest state atomically, removes old access and blocks stale collector writes", async () => {
    const old = await store.create(
      sessionHash("guest"),
      startPaper("100000000", ["leader"], now),
      now,
    );
    expect(
      await store.linkGuest(sessionHash("guest"), "wallet:" + wallet, now),
    ).toBe(true);
    expect(await store.get(sessionHash("guest"))).toBeNull();
    expect((await store.get("wallet:" + wallet))?.id).toBe(old.id);
    expect(await store.save(old)).toBe(false);
  });
  it("does not overwrite a saved wallet portfolio or migrate an expired guest", async () => {
    await store.create(
      "wallet:" + wallet,
      startPaper("200000000", ["leader"], now),
      now,
    );
    await store.create("guest", startPaper("100000000", ["leader"], now), now);
    expect(await store.linkGuest("guest", "wallet:" + wallet, now)).toBe(false);
    expect((await store.get("wallet:" + wallet))?.paper.budget).toBe(
      "200000000",
    );
    expect(await store.get("guest")).not.toBeNull();
    expect(
      await store.linkGuest("guest", "wallet:other", now + 8 * 86400000),
    ).toBe(false);
  });
});
