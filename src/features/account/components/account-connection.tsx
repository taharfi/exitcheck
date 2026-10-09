"use client";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import bs58 from "bs58";
import {
  waitForLoginSignature,
  loginMessageSigner,
  type PhantomMessageProvider,
} from "../wallet-message";
type User = { wallet: string; expiresAt: number };
const changed = () => window.dispatchEvent(new Event("exitcheck-account"));
export function AccountConnection({
  context = "portfolio",
}: {
  context?: "portfolio" | "agent" | "experiments";
}) {
  const { publicKey, signMessage, disconnect, wallet } = useWallet();
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [phase, setPhase] = useState<
    "idle" | "challenge" | "wallet" | "verify"
  >("idle");
  const loginAttempt = useRef<AbortController | null>(null);
  const previous = useRef<string | null>(null),
    current = useRef<string | null>(null);
  const address = publicKey?.toBase58() ?? null;
  useEffect(() => {
    current.current = address;
  }, [address]);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const r = await fetch("/api/auth", {
            cache: "no-store",
            signal: AbortSignal.timeout(15000),
          }),
          j = await r.json();
        if (!r.ok) throw Error(j.error?.message ?? "Account unavailable.");
        if (active) setUser(j.user);
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : "Account unavailable.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      loginAttempt.current?.abort();
    };
  }, []);
  const logout = useCallback(async () => {
    const r = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw Error("Could not sign out. Try again.");
    setUser(null);
    changed();
  }, []);
  useEffect(() => {
    const disconnected = previous.current !== null && address === null;
    previous.current = address;
    if (
      !loading &&
      user &&
      ((address && address !== user.wallet) || disconnected)
    )
      void logout().catch((e) =>
        setError(e instanceof Error ? e.message : "Could not sign out."),
      );
  }, [address, user, loading, logout]);
  async function login() {
    if (!address || !signMessage || loginAttempt.current) return;
    const attempt = new AbortController();
    loginAttempt.current = attempt;
    const signingWallet = address;
    setBusy(true);
    setError("");
    setPhase("challenge");
    try {
      const r = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "challenge", wallet: signingWallet }),
          signal: AbortSignal.any([attempt.signal, AbortSignal.timeout(15000)]),
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error?.message ?? "Could not start sign-in.");
      if (
        typeof j.message !== "string" ||
        typeof j.expiresAt !== "number" ||
        j.expiresAt <= Date.now()
      )
        throw Error(
          "The login message is unavailable or expired. Please try again.",
        );
      setPhase("wallet");
      const signer = loginMessageSigner(
        wallet?.adapter.name ?? "",
        signingWallet,
        signMessage,
        (window as Window & { phantom?: { solana?: PhantomMessageProvider } })
          .phantom?.solana,
      );
      const signature = await waitForLoginSignature(
        () => signer(new TextEncoder().encode(j.message)),
        attempt.signal,
      );
      attempt.signal.throwIfAborted();
      if (current.current !== signingWallet)
        throw Error("Wallet changed. Sign in again with the selected wallet.");
      setPhase("verify");
      const verified = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "verify",
            signature: bs58.encode(signature),
          }),
          signal: AbortSignal.any([attempt.signal, AbortSignal.timeout(15000)]),
        }),
        result = await verified.json();
      if (!verified.ok)
        throw Error(result.error?.message ?? "Sign-in could not be verified.");
      if (result.user?.wallet !== signingWallet)
        throw Error(
          "Sign-in returned an unexpected account. Please reconnect and try again.",
        );
      if (current.current !== signingWallet) {
        await logout();
        throw Error("Wallet changed during sign-in. Please try again.");
      }
      // Confirm the browser stored the HttpOnly session, not just the signature.
      const confirmed = await fetch("/api/auth", {
        cache: "no-store",
        signal: AbortSignal.any([attempt.signal, AbortSignal.timeout(15000)]),
      });
      const session = await confirmed.json();
      if (!confirmed.ok)
        throw Error(
          session.error?.message ??
            "Could not confirm your signed-in session. Please retry.",
        );
      if (session.user?.wallet !== signingWallet)
        throw Error(
          "Your browser did not retain the login session. Allow cookies for this app and try again.",
        );
      if (current.current !== signingWallet) {
        await logout();
        throw Error("Wallet changed during sign-in. Please try again.");
      }
      setUser(session.user);
      changed();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Sign-in was not completed. You can try again or continue as a guest.",
      );
    } finally {
      loginAttempt.current = null;
      setPhase("idle");
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    setError("");
    try {
      await logout();
      await disconnect();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign out.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account-connection" aria-label="User account">
      <div>
        <strong>
          {loading
            ? "Checking account..."
            : user
              ? "Signed in · " +
                user.wallet.slice(0, 6) +
                "…" +
                user.wallet.slice(-5)
              : context === "experiments"
                ? "Save your experiments"
                : context === "agent"
                  ? "Save your agent plan with your wallet"
                  : "Save your portfolio with your wallet"}
        </strong>
        <p>
          {context === "experiments"
            ? user
              ? "Your paper experiments are private to this wallet."
              : "Connect and sign in to save. No funds move."
            : user
              ? context === "agent"
                ? "Your agent plan is private to this wallet. Signing in does not authorize trades."
                : "Your virtual portfolio is linked to this wallet. Sign in with it on another browser to reopen it."
              : context === "agent"
                ? "Connect, then sign a login message to save your observation plan. No funds move."
                : "Connect, then sign a login message. No funds move. Guest testing is still available."}
        </p>
      </div>
      <div className="account-actions">
        {!loading && !user && <WalletMultiButton />}
        {!loading && !user && address && (
          <button
            className="paper-primary"
            disabled={busy || !signMessage || loading}
            onClick={() => void login()}
          >
            {busy
              ? phase === "challenge"
                ? "Preparing login message..."
                : phase === "wallet"
                  ? "Waiting for wallet approval..."
                  : "Verifying sign-in..."
              : "Sign in with wallet"}
          </button>
        )}
        {busy && phase === "wallet" && (
          <button
            className="text-button"
            type="button"
            onClick={() => loginAttempt.current?.abort()}
          >
            Cancel sign-in
          </button>
        )}
        {user && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void signOut()}
          >
            {busy ? "Signing out..." : "Sign out & disconnect"}
          </button>
        )}
      </div>
      {busy && phase !== "idle" && (
        <p role="status" aria-live="polite">
          {phase === "wallet"
            ? `Approve the login message inside ${wallet?.adapter.name ?? "your wallet"}, then return here. If the popup is stuck, cancel sign-in and close it before retrying.`
            : phase === "challenge"
              ? "Requesting a login message."
              : "Signature received. Confirming your account and browser session."}
        </p>
      )}
      {!user && address && !signMessage && (
        <p role="status">
          This wallet does not support message signing. Use a compatible wallet
          or continue as a guest.
        </p>
      )}
      {error && (
        <p role="alert" className="paper-error">
          {error}
        </p>
      )}
    </section>
  );
}
