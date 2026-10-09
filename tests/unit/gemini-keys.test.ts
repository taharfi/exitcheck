import { researchModel } from "@/features/trade/research";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configuredGeminiKeys,
  nextGeminiKey,
} from "@/features/trade/gemini-keys";
beforeEach(() => {
  vi.stubEnv("GEMINI_MODEL", "");
  vi.stubEnv("GEMINI_API_KEY", "");
  for (const n of [1, 2, 3]) vi.stubEnv(`GEMINI_API_KEY_${n}`, "");
  nextGeminiKey();
});
afterEach(() => vi.unstubAllEnvs());
describe("server Gemini keys", () => {
  it("keeps legacy single-key configuration working", () => {
    vi.stubEnv("GEMINI_API_KEY", "legacy-test-key");
    expect(nextGeminiKey()).toBe("legacy-test-key");
    expect(nextGeminiKey()).toBe("legacy-test-key");
  });
  it("rotates distinct numbered keys and ignores blanks and duplicates", () => {
    vi.stubEnv("GEMINI_API_KEY", "ignored-legacy-key");
    vi.stubEnv("GEMINI_API_KEY_1", " first-test-key ");
    vi.stubEnv("GEMINI_API_KEY_2", "second-test-key");
    vi.stubEnv("GEMINI_API_KEY_3", "first-test-key");
    expect(configuredGeminiKeys()).toEqual([
      "first-test-key",
      "second-test-key",
    ]);
    expect([nextGeminiKey(), nextGeminiKey(), nextGeminiKey()]).toEqual([
      "first-test-key",
      "second-test-key",
      "first-test-key",
    ]);
  });
  it("returns no credential for an empty configuration", () => {
    expect(nextGeminiKey()).toBeUndefined();
  });
});

describe("research model configuration", () => {
  it("defaults to stable Flash and accepts a configured Gemini model", () => {
    expect(researchModel()).toBe("gemini-2.5-flash");
    vi.stubEnv("GEMINI_MODEL", "gemini-3.8-flash");
    expect(researchModel()).toBe("gemini-3.8-flash");
  });
  it("rejects invalid model paths", () => {
    vi.stubEnv("GEMINI_MODEL", "../unexpected");
    expect(() => researchModel()).toThrow(/model name is invalid/);
  });
});
