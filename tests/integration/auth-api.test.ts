import { beforeEach, afterAll, expect, it, vi } from "vitest";
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
import { POST, GET } from "../../src/app/api/auth/route";
import {
  GET as portfolioGET,
  POST as portfolioPOST,
} from "../../src/app/api/shadow/route";
import { shadowStore } from "../../src/features/copy-trading/shadow-store";
const origin = "http://127.0.0.1:3000",
  pair = nacl.sign.keyPair(),
  wallet = bs58.encode(pair.publicKey);
function request(
  path: string,
  input?: unknown,
  cookie = "",
  requestOrigin = origin,
) {
  return new Request(origin + path, {
    method: input ? "POST" : "GET",
    headers: {
      origin: requestOrigin,
      "content-type": "application/json",
      cookie,
    },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
}
beforeEach(async () => {
  vi.stubEnv("APP_ORIGIN", origin);
  vi.stubEnv("SHADOW_COLLECTOR_ENABLED", "true");
  await shadowStore().db.exec("DELETE FROM shadow_portfolios;");
});
afterAll(() => {
  vi.unstubAllEnvs();
  shadowStore().db.close();
});
async function login(key = pair) {
  const c = await POST(
    request("/api/auth", {
      action: "challenge",
      wallet: bs58.encode(key.publicKey),
    }),
  );
  const challengeCookie = c.headers.getSetCookie()[0].split(";")[0],
    j = await c.json();
  const signature = bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(j.message), key.secretKey),
  );
  const r = await POST(
    request("/api/auth", { action: "verify", signature }, challengeCookie),
  );
  expect(r.status).toBe(200);
  return r.headers
    .getSetCookie()
    .find((x) => x.startsWith("exitcheck-account="))!
    .split(";")[0];
}
it("protects challenge origin and requires its browser cookie to verify", async () => {
  expect(
    (
      await POST(
        request(
          "/api/auth",
          { action: "challenge", wallet },
          "",
          "https://other.example",
        ),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await POST(
        request("/api/auth", { action: "verify", signature: "1".repeat(88) }),
      )
    ).status,
  ).toBe(401);
});
it("reopens the same portfolio from another signed-in browser and isolates other wallets", async () => {
  const first = await login();
  const created = await portfolioPOST(
    request(
      "/api/shadow",
      { action: "start", owners: [wallet], budget: "100000000" },
      first,
    ),
  );
  expect(created.status).toBe(200);
  const id = (await created.json()).portfolio.id;
  const second = await login();
  expect(
    (
      await (
        await portfolioGET(request("/api/shadow", undefined, second))
      ).json()
    ).portfolio.id,
  ).toBe(id);
  const other = await login(nacl.sign.keyPair());
  expect(
    (
      await (
        await portfolioGET(request("/api/shadow", undefined, other))
      ).json()
    ).portfolio,
  ).toBeNull();
  expect(
    (await portfolioPOST(request("/api/shadow", { action: "stop" }, other)))
      .status,
  ).toBe(404);
  expect(
    (await (await GET(request("/api/auth", undefined, first))).json()).user
      .wallet,
  ).toBe(wallet);
  expect(
    (await POST(request("/api/auth", { action: "logout" }, first))).status,
  ).toBe(200);
  expect(
    (
      await (
        await portfolioGET(request("/api/shadow", undefined, first))
      ).json()
    ).portfolio,
  ).toBeNull();
  expect(
    (
      await (
        await portfolioGET(request("/api/shadow", undefined, second))
      ).json()
    ).portfolio.id,
  ).toBe(id);
});
