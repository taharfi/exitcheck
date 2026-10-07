import { expect, it, vi } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
it("preserves Solana HTTP JSON-RPC encoding, response IDs, exact balance parsing and RPC errors with the pinned client", async () => {
  const calls: string[] = [];
  const transport = vi.fn(async (_url: unknown, options?: RequestInit) => {
    const request = JSON.parse(String(options?.body));
    calls.push(request.method);
    expect(request.jsonrpc).toBe("2.0");
    expect(typeof request.id).toBe("string");
    const response =
      request.method === "getGenesisHash"
        ? { result: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" }
        : request.method === "getBalance"
          ? { result: { context: { slot: 1 }, value: 1000000000 } }
          : { error: { code: -32000, message: "Synthetic RPC failure" } };
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: request.id, ...response }),
      { headers: { "content-type": "application/json" } },
    );
  });
  const connection = new Connection("http://127.0.0.1:8899", {
    fetch: transport,
    disableRetryOnRateLimit: true,
  });
  expect(await connection.getGenesisHash()).toBe(
    "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  );
  expect(
    await connection.getBalance(
      new PublicKey("11111111111111111111111111111111"),
    ),
  ).toBe(1000000000);
  await expect(connection.getVersion()).rejects.toThrow(
    "Synthetic RPC failure",
  );
  expect(calls).toEqual(["getGenesisHash", "getBalance", "getVersion"]);
});
