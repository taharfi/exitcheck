import { AppError } from "./errors";
/** Read a UTF-8 body with a byte cap before buffering the complete input. */
export async function readLimitedText(
  input: Request | Response,
  limit: number,
  tooLarge: () => AppError,
): Promise<string> {
  const length = input.headers.get("content-length");
  if (length && /^\d+$/.test(length) && BigInt(length) > BigInt(limit)) {
    await input.body?.cancel();
    throw tooLarge();
  }
  const reader = input.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0,
    text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw tooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
