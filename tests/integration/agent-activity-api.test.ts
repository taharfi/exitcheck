import { afterEach, expect, it, vi } from "vitest";
import { GET } from "../../src/app/api/agent/trader/route";
import { JupiterProvider } from "../../src/lib/provider/jupiter";
const trader = "DVHD66wYT5wFcgJ9K2SbtJTmbsJxzz6chkAzNwzbksdT";
const other = "11111111111111111111111111111111";
const request = (query: string) =>
  new Request("http://127.0.0.1:3000/api/agent/trader?" + query);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it("validates public-address inputs before any provider read", async () => {
  const provider = vi.spyOn(JupiterProvider.prototype, "request");
  for (const query of [
    "",
    "trader=invalid",
    "trader=" + trader + "&execute=true",
    "trader=" + trader + "&trader=" + other,
  ])
    expect((await GET(request(query))).status).toBe(422);
  expect(provider).not.toHaveBeenCalled();
});
it("allows a public preview, coalesces concurrent reads and expires cached evidence without provider writes", async () => {
  let now = 1700000000000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const provider = vi
    .spyOn(JupiterProvider.prototype, "request")
    .mockResolvedValue({ data: [], pagination: { end: 0, hasNext: false } });
  const responses = await Promise.all([
    GET(request("trader=" + trader)),
    GET(request("trader=" + trader)),
  ]);
  for (const response of responses) {
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.trader).toBe(trader);
    expect(data.lastFillAt).toBeNull();
    expect(data).not.toHaveProperty("plan");
  }
  expect(provider).toHaveBeenCalledOnce();
  now += 1000;
  expect(
    (await (await GET(request("trader=" + trader))).json()).retrievedAt,
  ).toBe(1700000000000);
  expect(provider).toHaveBeenCalledOnce();
  now += 30000;
  expect((await GET(request("trader=" + trader))).status).toBe(200);
  expect(provider).toHaveBeenCalledTimes(2);
  expect(provider.mock.calls.every((call) => call.length === 1)).toBe(true);
});
it("keeps provider failure distinct from a verified empty sample and permits retry", async () => {
  const provider = vi
    .spyOn(JupiterProvider.prototype, "request")
    .mockRejectedValueOnce(Error("Synthetic outage"))
    .mockResolvedValue({ data: [], pagination: { end: 0, hasNext: false } });
  expect((await GET(request("trader=" + other))).status).toBe(500);
  expect((await GET(request("trader=" + other))).status).toBe(200);
  expect(provider).toHaveBeenCalledTimes(2);
});
