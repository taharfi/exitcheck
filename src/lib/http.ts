import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { AppError } from "./errors";
import { readLimitedText } from "./read-limited-text";
const buckets = new Map<string, { count: number; reset: number }>();
export async function endpoint(
  request: Request,
  work: (id: string) => Promise<unknown>,
) {
  const requestId = randomUUID();
  try {
    const origin = request.headers.get("origin");
    const expected = process.env.APP_ORIGIN ?? new URL(request.url).origin;
    if (request.method !== "GET" && origin !== expected)
      throw new AppError(
        "INVALID_ORIGIN",
        "Request must originate from this application.",
        403,
      );
    if (
      request.method !== "GET" &&
      request.headers.get("content-type")?.split(";")[0] !== "application/json"
    )
      throw new AppError(
        "CONTENT_TYPE",
        "Use an application/json request.",
        415,
      );
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
    const now = Date.now(),
      bucket = buckets.get(ip);
    if (!bucket || bucket.reset < now)
      buckets.set(ip, { count: 1, reset: now + 60000 });
    else if (++bucket.count > 90)
      throw new AppError(
        "RATE_LIMIT",
        "Too many requests. Wait one minute before retrying.",
        429,
      );
    if (buckets.size > 10000)
      for (const [key, value] of buckets)
        if (value.reset < now) buckets.delete(key);
    const result = await work(requestId);
    return Response.json(result, {
      headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" },
    });
  } catch (error) {
    const known = error instanceof AppError;
    const status = known ? error.status : error instanceof ZodError ? 422 : 500;
    const message = known
      ? error.message
      : error instanceof ZodError
        ? "Request or provider data failed validation. No transaction was authorized."
        : "The request could not be completed. Refresh or reconcile your existing action.";
    console.error(
      JSON.stringify({
        requestId,
        event: "request_failed",
        code: known ? error.code : "VALIDATION_OR_INTERNAL",
        status,
      }),
    );
    return Response.json(
      {
        error: {
          code: known ? error.code : "VALIDATION_OR_INTERNAL",
          message,
          requestId,
        },
      },
      {
        status,
        headers: { "X-Request-ID": requestId, "Cache-Control": "no-store" },
      },
    );
  }
}
export async function body(request: Request) {
  const text = await readLimitedText(
    request,
    25000,
    () =>
      new AppError("BODY_TOO_LARGE", "Request exceeds the size limit.", 413),
  );
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError("INVALID_JSON", "Invalid JSON body.");
  }
}
