import { randomBytes } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  ShadowStore,
  shadowStore,
  sessionHash,
} from "../copy-trading/shadow-store";
import { AppError } from "../../lib/errors";
export const AUTH_COOKIE = "exitcheck-account",
  CHALLENGE_COOKIE = "exitcheck-login";
export function readCookie(request: Request, name: string) {
  const value = request.headers
    .get("cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + "="))
    ?.slice(name.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export function sessionCookie(
  request: Request,
  name: string,
  value: string,
  age: number,
) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(process.env.APP_ORIGIN ?? request.url).protocol === "https:" ? "; Secure" : ""}`;
}
export class AuthStore {
  constructor(readonly store: ShadowStore) {
    store.db
      .initialize(`CREATE TABLE IF NOT EXISTS login_challenges(id TEXT PRIMARY KEY,wallet TEXT NOT NULL,origin TEXT NOT NULL,message TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS login_sessions(id TEXT PRIMARY KEY,wallet TEXT NOT NULL,expires INTEGER NOT NULL);`);
  }
  async challenge(wallet: string, origin: string, now = Date.now()) {
    return await this.store.db.session(async () => {
      const token = randomBytes(32).toString("hex"),
        nonce = randomBytes(32).toString("hex"),
        expires = now + 300000;
      const message = `${new URL(origin).host} wants you to sign in with your Solana account:\n${wallet}\n\nSign in to ExitCheck and save your research and agent plans. This does not authorize transactions or move funds.\n\nURI: ${origin}\nVersion: 1\nChain ID: mainnet\nNonce: ${nonce}\nIssued At: ${new Date(now).toISOString()}\nExpiration Time: ${new Date(expires).toISOString()}`;
      await this.store.db
        .prepare("DELETE FROM login_challenges WHERE expires<?")
        .run(now);
      await this.store.db
        .prepare("DELETE FROM login_sessions WHERE expires<?")
        .run(now);
      await this.store.db
        .prepare("INSERT INTO login_challenges VALUES(?,?,?,?,?)")
        .run(sessionHash(token), wallet, origin, message, expires);
      return { token, message, expires };
    });
  }
  async verify(
    challengeToken: string,
    signature: string,
    origin: string,
    now = Date.now(),
  ) {
    return await this.store.db.session(async () => {
      const row = (await this.store.db
        .prepare(
          "SELECT wallet,origin,message,expires FROM login_challenges WHERE id=?",
        )
        .get(sessionHash(challengeToken))) as
        | { wallet: string; origin: string; message: string; expires: number }
        | undefined;
      if (!row || row.expires <= now || row.origin !== origin)
        throw new AppError(
          "LOGIN_EXPIRED",
          "Sign-in request expired or unavailable. Please try again.",
          401,
        );
      let valid = false;
      try {
        const bytes = bs58.decode(signature);
        valid =
          bytes.length === 64 &&
          nacl.sign.detached.verify(
            new TextEncoder().encode(row.message),
            bytes,
            new PublicKey(row.wallet).toBytes(),
          );
      } catch {}
      if (!valid)
        throw new AppError(
          "INVALID_SIGNATURE",
          "The wallet signature could not be verified.",
          401,
        );
      const token = randomBytes(32).toString("hex"),
        expires = now + 86400000;
      await this.store.db.exec("BEGIN IMMEDIATE");
      try {
        const removed = await this.store.db
          .prepare("DELETE FROM login_challenges WHERE id=? AND expires>?")
          .run(sessionHash(challengeToken), now);
        if (removed.changes !== 1)
          throw new AppError(
            "LOGIN_USED",
            "This sign-in request was already used.",
            401,
          );
        await this.store.db
          .prepare("INSERT INTO login_sessions VALUES(?,?,?)")
          .run(sessionHash(token), row.wallet, expires);
        await this.store.db.exec("COMMIT");
      } catch (e) {
        await this.store.db.exec("ROLLBACK");
        throw e;
      }
      return { token, user: { wallet: row.wallet, expiresAt: expires } };
    });
  }
  async user(token: string | null, now = Date.now()) {
    return await this.store.db.session(async () => {
      if (!token) return null;
      const row = (await this.store.db
        .prepare(
          "SELECT wallet,expires FROM login_sessions WHERE id=? AND expires>?",
        )
        .get(sessionHash(token), now)) as
        { wallet: string; expires: number } | undefined;
      return row ? { wallet: row.wallet, expiresAt: row.expires } : null;
    });
  }
  async revoke(token: string | null) {
    return await this.store.db.session(async () => {
      if (token)
        await this.store.db
          .prepare("DELETE FROM login_sessions WHERE id=?")
          .run(sessionHash(token));
    });
  }
}
export async function account(request: Request) {
  return await new AuthStore(shadowStore()).user(
    readCookie(request, AUTH_COOKIE),
  );
}
export async function portfolioKey(request: Request) {
  const user = await account(request);
  if (user) return "wallet:" + user.wallet;
  const guest = readCookie(request, "exitcheck-shadow");
  return guest ? sessionHash(guest) : null;
}
