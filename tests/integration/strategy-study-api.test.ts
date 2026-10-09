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
import { GET, POST } from "../../src/app/api/strategy-study/route";
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
it("requires wallet proof and same-origin approval to collect public observations", async () => {
  const input = { budget: 300 };
  expect((await POST(request("", input))).status).toBe(401);
  const cookie = await login();
  expect(
    (await POST(request(cookie, input, "https://other.example"))).status,
  ).toBe(403);
  expect((await POST(request(cookie, { budget: 0 }))).status).toBe(422);
});
it("returns an honest empty dataset, cash benchmark and mock-only execution", async () => {
  const r = await GET(request());
  expect(r.status).toBe(200);
  const data = await r.json();
  expect(data.study.observations).toBe(0);
  expect(data.study.qualified).toBe(false);
  expect(data.study.evaluation[0].cash).toBe(300);
  expect(data.mock.mode).toBe("mock");
  expect(data.study.latestCohort).toEqual([]);
});
