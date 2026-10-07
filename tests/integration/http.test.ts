import { afterEach, it, expect, vi } from "vitest";
import { endpoint, body } from "../../src/lib/http";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it("blocks cross-origin JSON writes before doing financial work", async () => {
  vi.stubEnv("APP_ORIGIN", "https://exitcheck.test");
  vi.spyOn(console, "error").mockImplementation(() => {});
  const work = vi.fn();
  const response = await endpoint(
    new Request("https://exitcheck.test/api/actions", {
      method: "POST",
      headers: {
        Origin: "https://attacker.test",
        "Content-Type": "application/json",
      },
      body: "{}",
    }),
    work,
  );
  expect(response.status).toBe(403);
  expect(work).not.toHaveBeenCalled();
  expect((await response.json()).error.code).toBe("INVALID_ORIGIN");
});
it("returns redacted errors and a request ID without leaking exceptions", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await endpoint(
    new Request("https://exitcheck.test/api/positions"),
    async () => {
      throw new Error("fixture-api-secret-value");
    },
  );
  expect(response.status).toBe(500);
  expect(response.headers.get("X-Request-ID")).toBeTruthy();
  const result = await response.text();
  expect(result).not.toContain("fixture-api-secret-value");
  expect(JSON.stringify(log.mock.calls)).not.toContain(
    "fixture-api-secret-value",
  );
});
it("rejects malformed or oversized JSON", async () => {
  await expect(
    body(
      new Request("https://exitcheck.test/api/actions", {
        method: "POST",
        body: "not json",
      }),
    ),
  ).rejects.toMatchObject({ code: "INVALID_JSON" });
  await expect(
    body(
      new Request("https://exitcheck.test/api/actions", {
        method: "POST",
        body: "x".repeat(25001),
      }),
    ),
  ).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
});
