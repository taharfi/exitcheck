export type PhantomMessageProvider = {
  isPhantom?: boolean;
  isConnected?: boolean;
  publicKey?: { toBase58(): string } | null;
  signMessage(
    message: Uint8Array,
    display: "utf8",
  ): Promise<{
    signature: Uint8Array;
    publicKey?: { toBase58(): string } | string;
  }>;
};

/** Use the documented Phantom bridge only for the selected, connected account. */
export function loginMessageSigner(
  walletName: string,
  address: string,
  standardSign: (message: Uint8Array) => Promise<Uint8Array>,
  phantom?: PhantomMessageProvider,
): (message: Uint8Array) => Promise<Uint8Array> {
  if (
    walletName !== "Phantom" ||
    !phantom?.isPhantom ||
    !phantom.isConnected ||
    typeof phantom.signMessage !== "function"
  )
    return standardSign;
  if (phantom.publicKey?.toBase58() !== address)
    throw Error(
      "Phantom's selected account changed. Reconnect the wallet before signing in.",
    );
  return async (message) => {
    const signed = await phantom.signMessage(message, "utf8");
    // The maintained Phantom adapter only requires `signature` in this response.
    // If a response key is supplied, validate it too. The server always verifies
    // the signature against the wallet bound to the original challenge.
    const responseAddress =
      typeof signed.publicKey === "string"
        ? signed.publicKey
        : signed.publicKey?.toBase58();
    if (
      (responseAddress !== undefined && responseAddress !== address) ||
      phantom.publicKey?.toBase58() !== address
    )
      throw Error(
        "Phantom's selected account changed during signing. Reconnect and try again.",
      );
    return signed.signature;
  };
}

/** Wallet APIs cannot be aborted. Ignore late results after cancellation/timeout. */
export function waitForLoginSignature(
  sign: () => Promise<Uint8Array>,
  signal: AbortSignal,
  timeoutMs = 60000,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error: Error | null, signature?: Uint8Array) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      if (error) reject(error);
      else resolve(signature!);
    };
    const cancel = () =>
      finish(
        new Error(
          "Sign-in cancelled. Close the pending wallet prompt before trying again.",
        ),
      );
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "Your wallet has not returned a signature. Close the pending wallet prompt, unlock your wallet, then try signing in again.",
          ),
        ),
      timeoutMs,
    );
    if (signal.aborted) {
      cancel();
      return;
    }
    signal.addEventListener("abort", cancel, { once: true });
    // Schedule the call so synchronous provider errors are handled too.
    Promise.resolve()
      .then(() => {
        if (finished) return null;
        return sign();
      })
      .then(
        (signature) => {
          if (finished) return;
          if (!signature || signature.length !== 64) {
            finish(
              new Error(
                "The wallet returned an invalid login signature. Please reconnect and try again.",
              ),
            );
          } else finish(null, Uint8Array.from(signature));
        },
        (error: unknown) =>
          finish(
            error instanceof Error
              ? error
              : new Error(
                  "The wallet did not complete message signing. Please try again.",
                ),
          ),
      );
  });
}
