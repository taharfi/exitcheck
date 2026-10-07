import { expect, it } from "vitest";
import { readLimitedText } from "../../src/lib/read-limited-text";
import { AppError } from "../../src/lib/errors";
const failure = () => new AppError("BODY_TOO_LARGE", "Too large", 413);
it("applies limits to UTF-8 bytes rather than string character count", async () => {
  await expect(
    readLimitedText(new Response("éé"), 3, failure),
  ).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
});
it("decodes split multi-byte characters without corrupting valid JSON", async () => {
  const bytes = new TextEncoder().encode('{"name":"é"}');
  const response = new Response(
    new ReadableStream({
      start(c) {
        for (const b of bytes) c.enqueue(Uint8Array.of(b));
        c.close();
      },
    }),
  );
  expect(await readLimitedText(response, 100, failure)).toBe('{"name":"é"}');
});
it("cancels a growing stream immediately when its byte cap is exceeded", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(5));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  await expect(readLimitedText(response, 4, failure)).rejects.toMatchObject({
    code: "BODY_TOO_LARGE",
  });
  expect(cancelled).toBe(true);
});
it("rejects an oversized content-length header before buffering its body", async () => {
  await expect(
    readLimitedText(
      new Response("small", { headers: { "content-length": "1000" } }),
      10,
      failure,
    ),
  ).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
});
