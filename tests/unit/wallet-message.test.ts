import { afterEach, expect, it, vi } from "vitest";
import {
  waitForLoginSignature,
  loginMessageSigner,
  type PhantomMessageProvider,
} from "../../src/features/account/wallet-message";
afterEach(() => vi.useRealTimers());

it("times out a wallet that never responds and ignores late approval", async () => {
  vi.useFakeTimers();
  let release!: (signature: Uint8Array) => void;
  const result = waitForLoginSignature(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    new AbortController().signal,
    1000,
  );
  const rejected = expect(result).rejects.toThrow(
    "has not returned a signature",
  );
  await vi.advanceTimersByTimeAsync(1000);
  await rejected;
  release(new Uint8Array(64));
  await Promise.resolve();
  expect(vi.getTimerCount()).toBe(0);
});
it("allows cancelling pending approval and does not invoke an already cancelled request", async () => {
  const controller = new AbortController();
  const sign = vi.fn(() => new Promise<Uint8Array>(() => {}));
  const pending = waitForLoginSignature(sign, controller.signal);
  await Promise.resolve();
  controller.abort();
  await expect(pending).rejects.toThrow("Sign-in cancelled");
  const unused = vi.fn();
  await expect(
    waitForLoginSignature(unused, controller.signal),
  ).rejects.toThrow("Sign-in cancelled");
  expect(unused).not.toHaveBeenCalled();
});
it("validates signature length and propagates wallet rejection", async () => {
  const signal = new AbortController().signal;
  await expect(
    waitForLoginSignature(async () => new Uint8Array(10), signal),
  ).rejects.toThrow("invalid login signature");
  await expect(
    waitForLoginSignature(async () => {
      throw Error("User rejected");
    }, signal),
  ).rejects.toThrow("User rejected");
  const signed = new Uint8Array(64).fill(42);
  expect(await waitForLoginSignature(async () => signed, signal)).toEqual(
    signed,
  );
});
it("uses Phantom UTF-8 message signing for the matching connected account without a second prompt", async () => {
  const key = { toBase58: () => "wallet-a" };
  const standard = vi.fn();
  const signature = new Uint8Array(64);
  const provider = {
    isPhantom: true,
    isConnected: true,
    publicKey: key,
    signMessage: vi.fn(async () => ({ publicKey: key, signature })),
  };
  const message = new TextEncoder().encode("login");
  expect(
    await loginMessageSigner(
      "Phantom",
      "wallet-a",
      standard,
      provider,
    )(message),
  ).toBe(signature);
  expect(provider.signMessage).toHaveBeenCalledWith(message, "utf8");
  expect(standard).not.toHaveBeenCalled();
});
it("never routes another wallet to Phantom and preserves standard signing when injection is absent", () => {
  const standard = vi.fn();
  const provider = {
    isPhantom: true,
    isConnected: true,
    publicKey: { toBase58: () => "other" },
    signMessage: vi.fn(),
  };
  expect(
    loginMessageSigner("Other wallet", "wallet-a", standard, provider),
  ).toBe(standard);
  expect(loginMessageSigner("Phantom", "wallet-a", standard)).toBe(standard);
  expect(() =>
    loginMessageSigner("Phantom", "wallet-a", standard, provider),
  ).toThrow("selected account changed");
});
it("rejects a Phantom account change or mismatched response after approval", async () => {
  const provider: PhantomMessageProvider = {
    isPhantom: true,
    isConnected: true,
    publicKey: { toBase58: () => "wallet-a" },
    signMessage: async () => ({
      signature: new Uint8Array(64),
      publicKey: { toBase58: () => "other" },
    }),
  };
  await expect(
    loginMessageSigner(
      "Phantom",
      "wallet-a",
      vi.fn(),
      provider,
    )(new Uint8Array()),
  ).rejects.toThrow("changed during signing");
});

it("accepts a signature-only Phantom response and a matching string key", async () => {
  const signature = new Uint8Array(64);
  const provider: PhantomMessageProvider = {
    isPhantom: true,
    isConnected: true,
    publicKey: { toBase58: () => "wallet-a" },
    signMessage: async () => ({ signature }),
  };
  const sign = loginMessageSigner("Phantom", "wallet-a", vi.fn(), provider);
  expect(await sign(new Uint8Array())).toBe(signature);
  provider.signMessage = async () => ({ signature, publicKey: "wallet-a" });
  expect(await sign(new Uint8Array())).toBe(signature);
  provider.signMessage = async () => ({ signature, publicKey: "other" });
  await expect(sign(new Uint8Array())).rejects.toThrow("changed during signing");
});

it("rejects a provider account change even when the response has no public key", async () => {
  const provider: PhantomMessageProvider = {
    isPhantom: true,
    isConnected: true,
    publicKey: { toBase58: () => "wallet-a" },
    signMessage: async () => {
      provider.publicKey = { toBase58: () => "other" };
      return { signature: new Uint8Array(64) };
    },
  };
  await expect(
    loginMessageSigner("Phantom", "wallet-a", vi.fn(), provider)(new Uint8Array()),
  ).rejects.toThrow("changed during signing");
});
