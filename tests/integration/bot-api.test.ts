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
import { GET, POST } from "../../src/app/api/bot/route";
import { AuthStore, AUTH_COOKIE } from "../../src/features/account/auth";
import { shadowStore } from "../../src/features/copy-trading/shadow-store";
const origin = "http://127.0.0.1:3000";
function request(cookie = "", body?: unknown, source = origin) {
  return new Request(origin + "/api/bot", {
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
it("requires wallet proof, enforces origin and validates paper budgets", async () => {
  const body = { budget: "100", strategy: "Momentum", watching: true };
  expect((await POST(request("", body))).status).toBe(401);
  const cookie = await login();
  expect(
    (await POST(request(cookie, body, "https://other.example"))).status,
  ).toBe(403);
  expect((await POST(request(cookie, { ...body, budget: "99" }))).status).toBe(
    422,
  );
});
it("keeps paper plans private between verified wallets and anonymous browsers", async () => {
  const first = await login(),
    second = await login();
  expect(
    (
      await POST(
        request(first, { budget: "250", strategy: "Momentum", watching: true }),
      )
    ).status,
  ).toBe(200);
  expect((await (await GET(request(first))).json()).bot.budget).toBe("250");
  expect((await (await GET(request(second))).json()).bot).toBeNull();
  expect((await (await GET(request())).json()).bot).toBeNull();
  expect((await (await GET(request(first))).json()).execution).toBe("disabled");
});
