import { afterAll, expect, it, vi } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
vi.mock(
  "../../src/features/copy-trading/shadow-store",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/features/copy-trading/shadow-store")
      >();
    const store = new actual.ShadowStore(":memory:");
    return { ...actual, shadowStore: () => store };
  },
);
import { GET, POST } from "@/app/api/trade/journal/route";
import { emptyPaperAccount } from "@/features/trade/paper";
import { AuthStore, AUTH_COOKIE } from "@/features/account/auth";
import { shadowStore } from "@/features/copy-trading/shadow-store";
const origin = "http://127.0.0.1:3000";
function request(cookie = "", body?: unknown, source = origin) {
  return new Request(origin + "/api/trade/journal", {
    method: body ? "POST" : "GET",
    headers: { origin: source, cookie, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function login() {
  const key = nacl.sign.keyPair(),
    auth = new AuthStore(shadowStore());
  const c = await auth.challenge(bs58.encode(key.publicKey), origin);
  const signature = bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(c.message), key.secretKey),
  );
  return `${AUTH_COOKIE}=${(await auth.verify(c.token, signature, origin)).token}`;
}
afterAll(() => shadowStore().db.close());
it("requires sign-in, blocks cross-origin writes, validates balances and isolates private backups", async () => {
  const account = emptyPaperAccount();
  expect((await POST(request("", { account }))).status).toBe(401);
  const first = await login(),
    second = await login();
  expect(
    (await POST(request(first, { account }, "https://attacker.test"))).status,
  ).toBe(403);
  expect(
    (await POST(request(first, { account: { ...account, cash: "1" } }))).status,
  ).toBe(422);
  expect((await POST(request(first, { account }))).status).toBe(200);
  expect((await (await GET(request(first))).json()).account.cash).toBe(
    account.cash,
  );
  expect((await (await GET(request(second))).json()).account).toBeNull();
  expect((await (await GET(request())).json()).signedIn).toBe(false);
});
