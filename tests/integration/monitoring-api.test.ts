import { afterEach, beforeEach, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({
  claim: vi.fn(),
  release: vi.fn(),
  start: vi.fn(),
}));
vi.mock("../../src/lib/server/monitoring", () => ({
  claimMonitoring: calls.claim,
  releaseMonitoring: calls.release,
}));
vi.mock("workflow/api", () => ({ start: calls.start }));
vi.mock("../../src/workflows/monitoring", () => ({
  monitorExitCheck: vi.fn(),
}));
import { GET } from "../../src/app/api/internal/monitoring/route";
const request = (secret = "test-only-secret") =>
  new Request("https://exitcheck.xyz/api/internal/monitoring", {
    headers: { authorization: `Bearer ${secret}` },
  });
beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-only-secret");
  vi.stubEnv("MONITORING_WORKFLOW_ENABLED", "true");
  calls.claim.mockResolvedValue(true);
  calls.start.mockResolvedValue({ runId: "test-run" });
  calls.release.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
it("rejects missing or incorrect operator authentication before touching storage", async () => {
  expect((await GET(request("wrong"))).status).toBe(401);
  vi.stubEnv("CRON_SECRET", "");
  expect((await GET(request())).status).toBe(401);
  expect(calls.claim).not.toHaveBeenCalled();
  expect(calls.start).not.toHaveBeenCalled();
});
it("starts one workflow only after atomically claiming monitoring", async () => {
  expect(await (await GET(request())).json()).toEqual({
    running: true,
    started: true,
    runId: "test-run",
  });
  calls.claim.mockResolvedValue(false);
  expect(await (await GET(request())).json()).toEqual({
    running: true,
    started: false,
  });
  expect(calls.start).toHaveBeenCalledTimes(1);
});
it("releases the reservation when workflow launch fails", async () => {
  calls.start.mockRejectedValueOnce(new Error("test launch failure"));
  expect((await GET(request())).status).toBe(503);
  expect(calls.release).toHaveBeenCalledWith(calls.claim.mock.calls[0][0]);
});
it("honors the operator disable switch", async () => {
  vi.stubEnv("MONITORING_WORKFLOW_ENABLED", "false");
  expect(await (await GET(request())).json()).toEqual({ enabled: false });
  expect(calls.start).not.toHaveBeenCalled();
  expect(calls.claim).not.toHaveBeenCalled();
});
