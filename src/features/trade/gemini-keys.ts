// Server-only: never import this module into a client component.
let cursor = 0;
let configuration = "";
export function configuredGeminiKeys(): string[] {
  const numbered = [1, 2, 3]
    .map((n) => process.env[`GEMINI_API_KEY_${n}`]?.trim())
    .filter((key): key is string => Boolean(key));
  return [
    ...new Set(
      numbered.length
        ? numbered
        : [process.env.GEMINI_API_KEY?.trim()].filter((key): key is string =>
            Boolean(key),
          ),
    ),
  ];
}
export function nextGeminiKey(): string | undefined {
  const keys = configuredGeminiKeys();
  const signature = JSON.stringify(keys);
  if (signature !== configuration) {
    configuration = signature;
    cursor = 0;
  }
  if (!keys.length) return undefined;
  const key = keys[cursor % keys.length];
  cursor = (cursor + 1) % keys.length;
  return key;
}
