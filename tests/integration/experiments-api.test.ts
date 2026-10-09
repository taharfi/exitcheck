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
import { GET, POST } from "../../src/app/api/experiments/route";
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
it("requires sign-in and approval, keeps records isolated, and enforces ownership", async () => {
  const plan = { budget: 300, days: 7 };
  expect(
    (await POST(request("", { action: "create", plan, approved: true })))
      .status,
  ).toBe(401);
  const first = await login(),
    second = await login();
  expect(
    (await POST(request(first, { action: "create", plan, approved: false })))
      .status,
  ).toBe(422);
  expect(
    (
      await POST(
        request(
          first,
          { action: "create", plan, approved: true },
          "https://evil.example",
        ),
      )
    ).status,
  ).toBe(403);
  const response = await POST(
    request(first, { action: "create", plan, approved: true }),
  );
  expect(response.status).toBe(200);
  const { experiment } = await response.json();
  expect((await (await GET(request(first))).json()).experiments).toHaveLength(
    1,
  );
  expect((await (await GET(request(second))).json()).experiments).toHaveLength(
    0,
  );
  expect((await (await GET(request())).json()).experiments).toHaveLength(0);
  expect(
    (await POST(request(second, { action: "pause", id: experiment.id })))
      .status,
  ).toBe(404);
  expect(
    (await POST(request(first, { action: "pause", id: experiment.id }))).status,
  ).toBe(200);
  expect((await (await GET(request(first))).json()).experiments[0].paused).toBe(
    true,
  );
});
