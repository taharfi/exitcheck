import { beforeEach, afterAll, expect, it, vi } from "vitest";
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
import { GET, POST } from "../../src/app/api/shadow/route";
import { shadowStore } from "../../src/features/copy-trading/shadow-store";
import { startPaper } from "../../src/features/copy-trading/paper";
const origin = "http://127.0.0.1:3000",
  owner = "E1Uc6BvyLS1cP47yuYq4sGQqbQPrrH6YKVuth88NzeHm";
async function post(input: unknown, cookie?: string, requestOrigin = origin) {
  return await POST(
    new Request(origin + "/api/shadow", {
      method: "POST",
      headers: {
        origin: requestOrigin,
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(input),
    }),
  );
}
beforeEach(async () => {
  vi.stubEnv("APP_ORIGIN", origin);
  vi.stubEnv("SHADOW_COLLECTOR_ENABLED", "true");
  await shadowStore().db.exec(
    "DELETE FROM shadow_portfolios; DELETE FROM shadow_observations;",
  );
});
afterAll(() => {
  vi.unstubAllEnvs();
  shadowStore().db.close();
});
it("protects mutation from other origins", async () => {
  expect(
    (
      await post(
        { action: "start", owners: [owner], budget: "100000000" },
        undefined,
        "https://elsewhere.example",
      )
    ).status,
  ).toBe(403);
  expect(await shadowStore().active()).toHaveLength(0);
});
it("keeps resume idempotent for an active portfolio at monitoring capacity", async () => {
  const created = await post({
    action: "start",
    owners: [owner],
    budget: "100000000",
  });
  const cookie = created.headers.get("set-cookie")!.split(";")[0];
  const original = (await created.json()).portfolio;
  for (let i = 0; i < 24; i++)
    await shadowStore().create(
      "extra-session-" + i,
      startPaper("100000000", [owner]),
    );
  const resumed = await post({ action: "resume" }, cookie);
  expect(resumed.status).toBe(200);
  const row = (await resumed.json()).portfolio;
  expect(row.acceptAfter).toBe(original.acceptAfter);
  expect(row.gaps).toBe(original.gaps);
});
it("issues a private cookie, isolates browsers, and preserves existing portfolios", async () => {
  const created = await post({
    action: "start",
    owners: [owner],
    budget: "100000000",
  });
  expect(created.status).toBe(200);
  const header = created.headers.get("set-cookie")!;
  expect(header).toContain("HttpOnly");
  expect(header).toContain("SameSite=Strict");
  const cookie = header.split(";")[0];
  expect((await created.json()).portfolio).not.toHaveProperty("session");
  expect(
    (await (await GET(new Request(origin + "/api/shadow"))).json()).portfolio,
  ).toBeNull();
  expect(
    (
      await (
        await GET(new Request(origin + "/api/shadow", { headers: { cookie } }))
      ).json()
    ).portfolio.paper.budget,
  ).toBe("100000000");
  expect(
    (
      await post(
        { action: "start", owners: [owner], budget: "200000000" },
        cookie,
      )
    ).status,
  ).toBe(409);
  expect(
    (await post({ action: "pause" }, "exitcheck-shadow=" + "0".repeat(64)))
      .status,
  ).toBe(404);
});
it("pauses, resumes without replaying paused trades, and stops only the owning session", async () => {
  const created = await post({
    action: "start",
    owners: [owner],
    budget: "100000000",
  });
  const cookie = created.headers.get("set-cookie")!.split(";")[0];
  expect(
    (await (await post({ action: "pause" }, cookie)).json()).portfolio.paper
      .paused,
  ).toBe(true);
  const resumed = await (await post({ action: "resume" }, cookie)).json();
  expect(resumed.portfolio.paper.paused).toBe(false);
  expect(resumed.portfolio.gaps).toBe(1);
  expect((await post({ action: "stop" })).status).toBe(404);
  expect(
    (await (await post({ action: "stop" }, cookie)).json()).portfolio,
  ).toBeNull();
});
it("fails closed when disabled or wallet input is invalid", async () => {
  vi.stubEnv("SHADOW_COLLECTOR_ENABLED", "false");
  expect(
    (await post({ action: "start", owners: [owner], budget: "100000000" }))
      .status,
  ).toBe(503);
  vi.stubEnv("SHADOW_COLLECTOR_ENABLED", "true");
  expect(
    (
      await post({
        action: "start",
        owners: [owner, owner],
        budget: "100000000",
      })
    ).status,
  ).toBe(422);
  expect(
    (await post({ action: "start", owners: [owner], budget: "1" })).status,
  ).toBe(422);
});
