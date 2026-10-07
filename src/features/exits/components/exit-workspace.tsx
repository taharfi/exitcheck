"use client";
import { AppHeader } from "@/components/app-header";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { decimal, decimalToMicro, money, units } from "@/lib/amounts";
import type { Position, Preview, PreparedAction } from "@/features/exits/types";
import { MAX_SNAPSHOT_AGE } from "@/features/exits/calculations";

interface Health {
  status: string;
  mode: "production" | "fixture";
  setup: string | null;
  executionEnabled: boolean;
}
const labels: Record<Position["state"], string> = {
  open: "Open",
  "awaiting-resolution": "Awaiting resolution",
  claimable: "Ready to claim",
  "no-payout": "No payout",
  claimed: "Claimed",
  unsupported: "Unsupported",
};
const actionLabels: Record<PreparedAction["status"], string> = {
  prepared: "Ready for review",
  "awaiting-signature": "Awaiting your signature",
  rejected: "Rejected by user",
  submitting: "Submitting on-chain",
  submitted: "Submitted on-chain",
  confirmed: "Confirmed on-chain",
  "order-pending": "Order pending",
  "partially-filled": "Partially filled",
  filled: "Filled",
  failed: "Failed",
  cancelled: "Cancelled",
  unknown: "Outcome unknown",
  claimed: "Claim confirmed",
};
const short = (v: string) => `${v.slice(0, 5)}…${v.slice(-5)}`;
const quantityAtPercent = (quantity: string, percent: bigint) =>
  decimal((units(quantity) * percent) / 100n);
const formatLamports = (value: string) =>
  `${BigInt(value) / 1_000_000_000n}.${(BigInt(value) % 1_000_000_000n).toString().padStart(9, "0")} SOL`;
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error
        ? `${data.error.message} (Reference: ${data.error.requestId.slice(0, 8)})`
        : (data.setup ?? "Service unavailable."),
    );
  return data;
}
function Arrow({ back = false }: { back?: boolean }) {
  return <span aria-hidden="true">{back ? "←" : "↗"}</span>;
}
function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: React.ReactNode;
  note?: string;
}) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {note && <small>{note}</small>}
    </div>
  );
}
export function ExitWorkspace() {
  const wallet = useWallet();
  const [health, setHealth] = useState<Health | null>(null);
  const [owner, setOwner] = useState("");
  const [loadedOwner, setLoadedOwner] = useState("");
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [selected, setSelected] = useState<Position | null>(null);
  const [quantity, setQuantity] = useState("");
  const [minimum, setMinimum] = useState("");
  const [view, setView] = useState<Preview | null>(null);
  const [action, setAction] = useState<PreparedAction | null>(null);
  const [fixtureReview, setFixtureReview] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState("all");
  const [how, setHow] = useState(false);
  const [trustAccepted, setTrustAccepted] = useState(false);
  const previewSequence = useRef(0);
  useEffect(() => {
    if (!how) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector(".how-modal");
    const focusable = () =>
      Array.from(
        modal?.querySelectorAll<HTMLElement>("button, a[href], input") ?? [],
      );
    focusable()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHow(false);
      if (event.key === "Tab") {
        const items = focusable(),
          first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [how]);
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() =>
        setError(
          "ExitCheck could not reach its server. Check your connection and reload.",
        ),
      );
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const saved = localStorage.getItem("exitcheck-action");
    if (saved) {
      try {
        const recovery = JSON.parse(saved);
        api<PreparedAction>(`/api/actions/${recovery.id}`, {
          token: recovery.token,
          operation: "status",
        })
          .then((a) => {
            setAction(a);
            setLoadedOwner(a.owner);
          })
          .catch(() =>
            setError(
              "A saved action could not be reconciled. Keep its recovery details and retry before creating another.",
            ),
          );
      } catch {
        localStorage.removeItem("exitcheck-action");
      }
    }
    return () => clearInterval(timer);
  }, []);
  const persist = useCallback((a: PreparedAction) => {
    setAction(a);
    localStorage.setItem(
      "exitcheck-action",
      JSON.stringify({ id: a.id, token: a.token }),
    );
  }, []);
  const reconcile = useCallback(async () => {
    if (!action) return;
    try {
      persist(
        await api<PreparedAction>(`/api/actions/${action.id}`, {
          token: action.token,
          operation: "status",
        }),
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [action, persist]);
  useEffect(() => {
    if (
      !action ||
      [
        "prepared",
        "rejected",
        "failed",
        "cancelled",
        "filled",
        "claimed",
      ].includes(action.status)
    )
      return;
    const timer = setInterval(() => void reconcile(), 6000);
    return () => clearInterval(timer);
  }, [action, reconcile]);
  async function lookup(address = owner) {
    setBusy("lookup");
    setError("");
    setSelected(null);
    setView(null);
    setFixtureReview(false);
    try {
      const data = await api<{ positions: Position[]; mode: string }>(
        `/api/positions?owner=${encodeURIComponent(address)}`,
      );
      setPositions(data.positions);
      setLoadedOwner(address);
      setOwner(address);
    } catch (e) {
      setError((e as Error).message);
      setPositions(null);
    } finally {
      setBusy(null);
    }
  }
  async function refresh(position = selected, amount = quantity) {
    if (!position) return;
    const sequence = ++previewSequence.current;
    setBusy("preview");
    setError("");
    try {
      const q = decimalToMicro(amount).toString();
      const result = await api<Preview>("/api/preview", {
        owner: loadedOwner,
        positionId: position.id,
        quantity: q,
      });
      if (sequence !== previewSequence.current) return;
      setView(result);
      setSelected(result.position);
    } catch (e) {
      if (sequence === previewSequence.current) {
        setError((e as Error).message);
        setView(null);
      }
    } finally {
      if (sequence === previewSequence.current) setBusy(null);
    }
  }
  function select(p: Position) {
    previewSequence.current++;
    setSelected(p);
    setQuantity(decimal(p.quantity));
    setView(null);
    setMinimum("");
    setFixtureReview(false);
    void refresh(p, decimal(p.quantity));
  }
  function changeQuantity(value: string) {
    setQuantity(value);
    setView(null);
    setFixtureReview(false);
    previewSequence.current++;
  }
  function shortcut(percent: bigint) {
    if (!selected) return;
    const value = decimal((units(selected.quantity) * percent) / 100n);
    setQuantity(value);
    setView(null);
    void refresh(selected, value);
  }
  const stale =
    !!view?.estimate && now - view.estimate.capturedAt > MAX_SNAPSHOT_AGE;
  const ownerMatches =
    !!wallet.publicKey && wallet.publicKey.toBase58() === loadedOwner;
  const actionable =
    selected?.state === "open" || selected?.state === "claimable";
  async function prepare() {
    if (!selected || !view) return;
    if (health?.mode === "fixture") {
      setFixtureReview(true);
      return;
    }
    setBusy("prepare");
    setError("");
    try {
      if (!ownerMatches)
        throw new Error(
          "Connect the wallet that owns this position before preparing a transaction.",
        );
      const a = await api<PreparedAction>("/api/actions", {
        owner: loadedOwner,
        positionId: selected.id,
        quantity: decimalToMicro(quantity).toString(),
        kind: selected.state === "claimable" ? "claim" : "sell",
        minimumPrice: minimum ? decimalToMicro(minimum).toString() : "0",
      });
      persist(a);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function sign() {
    if (
      !action ||
      !wallet.signTransaction ||
      !ownerMatches ||
      !action.signingEnabled ||
      !trustAccepted
    )
      return;
    setBusy("sign");
    setError("");
    try {
      if (now > action.expiresAt)
        throw new Error(
          "This action expired. Reconcile or discard it and prepare a fresh transaction.",
        );
      setAction({ ...action, status: "awaiting-signature" });
      const signed = await wallet.signTransaction(
        VersionedTransaction.deserialize(
          Buffer.from(action.transaction, "base64"),
        ),
      );
      persist(
        await api<PreparedAction>(`/api/actions/${action.id}/submit`, {
          token: action.token,
          signedTransaction: Buffer.from(signed.serialize()).toString("base64"),
        }),
      );
    } catch (e) {
      const message = (e as Error).message;
      if (/reject|declin|cancel/i.test(message)) {
        try {
          persist(
            await api<PreparedAction>(`/api/actions/${action.id}`, {
              token: action.token,
              operation: "reject",
            }),
          );
        } catch {
          setError(
            "Wallet rejected the signature. Reconcile the prepared action before continuing.",
          );
        }
      } else {
        setError(message);
        void reconcile();
      }
    } finally {
      setBusy(null);
    }
  }
  async function discard() {
    if (action?.status === "prepared") {
      try {
        await api(`/api/actions/${action.id}`, {
          token: action.token,
          operation: "reject",
        });
      } catch (e) {
        setError((e as Error).message);
        return;
      }
    }
    setAction(null);
    localStorage.removeItem("exitcheck-action");
  }
  const filtered = positions?.filter(
    (p) =>
      filter === "all" ||
      (filter === "open" ? p.state === "open" : p.state === "claimable"),
  );
  return (
    <>
      <AppHeader
        badge="BETA"
        actions={
          <>
            <button
              className="text-button how-link"
              onClick={() => setHow(true)}
            >
              How it works
            </button>
            <WalletMultiButton>
              {wallet.publicKey
                ? short(wallet.publicKey.toBase58())
                : "Connect wallet"}
            </WalletMultiButton>
          </>
        }
      />
      {health?.mode === "fixture" && (
        <div className="fixture-banner">
          <strong>Development fixtures</strong>
          <span>
            Sample positions and liquidity. No user funds. Signing is disabled.
          </span>
        </div>
      )}
      <main>
        <div className="context-line">
          <span className="network">
            <span className="dot" />
            Solana mainnet
          </span>
          <span className="context-divider">/</span>
          <span>Jupiter Prediction</span>
          <span className="context-right">EXIT WORKSPACE</span>
        </div>
        <div className="page-heading">
          <div>
            <p className="eyebrow">A CLEARER WAY OUT</p>
            <h1>
              {action
                ? "Track your exit."
                : selected
                  ? "Check your exit."
                  : positions
                    ? "Your positions."
                    : "Know what comes back."}
            </h1>
            <p>
              {action
                ? "Follow the transaction and the fill as separate steps."
                : selected
                  ? "See what your selected size can receive before you sign."
                  : positions
                    ? "Choose a position to inspect its exit or claim path."
                    : "Turn a displayed position value into a size-aware exit estimate."}
            </p>
          </div>
          <div className="heading-note">
            <span>One provider. Your wallet.</span>
            <strong>No custody. You approve every action.</strong>
          </div>
        </div>
        {error && (
          <div className="notice error" role="alert">
            <strong>Unable to complete this step</strong>
            <p>{error}</p>
            <button className="text-button" onClick={() => setError("")}>
              Dismiss
            </button>
          </div>
        )}
        {action ? (
          <section className="review-layout">
            <div className="review-main">
              <p className="eyebrow">
                {action.kind === "claim" ? "WINNING CLAIM" : "SELL ORDER"} ·
                REVIEW & TRACK
              </p>
              <h2>{actionLabels[action.status]}</h2>
              <p className="muted">
                {action.kind === "sell"
                  ? "Create a keeper-filled sell order for your existing position. Confirmation creates the order; the sale completes only when it fills."
                  : "Claim the payout of a resolved winning position."}
              </p>
              <dl className="review-details">
                <Metric label="Position" value={short(action.positionId)} />
                <Metric
                  label="Owner wallet"
                  value={short(action.owner)}
                  note={
                    ownerMatches
                      ? "Connected owner verified"
                      : "Connect the owning wallet to continue"
                  }
                />
                <Metric label="Network" value="Solana mainnet-beta" />
                <Metric
                  label="Quantity"
                  value={`${decimal(action.quantity)} contracts`}
                />
                <Metric label="Receiving asset" value={action.asset} />
                <Metric
                  label="Estimated net proceeds"
                  value={money(action.expectedNet, 6)}
                />
                <Metric
                  label="Estimated provider fees"
                  value={money(action.estimatedFee, 6)}
                />
                <Metric
                  label="Network fee"
                  value={
                    action.networkFee
                      ? formatLamports(action.networkFee)
                      : "Not verified"
                  }
                />
                <Metric
                  label="Protected sale price"
                  value={money(action.minSellPrice, 6)}
                  note="Provider-reported floor; encoded instruction semantics rely on Jupiter"
                />
                <Metric label="Simulation" value={action.simulation} />
              </dl>
              <details>
                <summary>Transaction programs and accounts</summary>
                <p className="muted">
                  Allowlisting verifies program identity. It does not decode all
                  instructions or prove receiving destinations.
                </p>
                <ul className="address-list">
                  {action.programs.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                <p className="muted">Accounts</p>
                <ul className="address-list">
                  {action.accounts.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </details>
              {action.error && (
                <div className="notice warning">
                  <p>{action.error}</p>
                </div>
              )}
              {action.status === "prepared" && (
                <div className="review-buttons">
                  <label className="trust-acknowledgement">
                    <input
                      type="checkbox"
                      checked={trustAccepted}
                      onChange={(e) => setTrustAccepted(e.target.checked)}
                    />{" "}
                    I understand the remaining provider trust and that
                    confirmation does not guarantee a fill.
                  </label>
                  <button
                    className="primary"
                    disabled={
                      !!busy ||
                      !action.signingEnabled ||
                      !ownerMatches ||
                      !trustAccepted ||
                      now > action.expiresAt
                    }
                    onClick={() => void sign()}
                  >
                    Sign with wallet <Arrow />
                  </button>
                  <button className="secondary" onClick={() => void discard()}>
                    Discard prepared action
                  </button>
                </div>
              )}
              <button className="text-button" onClick={() => void reconcile()}>
                Refresh action status ↻
              </button>
              {[
                "filled",
                "claimed",
                "rejected",
                "failed",
                "cancelled",
              ].includes(action.status) && (
                <button className="secondary" onClick={() => void discard()}>
                  Return to positions
                </button>
              )}
            </div>
            <aside className="result-panel">
              <p className="eyebrow">VERIFIED RESULT</p>
              <div className="result-number">
                {action.actualReceived === null
                  ? "—"
                  : money(action.actualReceived, 6)}
              </div>
              <p>
                {action.actualReceived === null
                  ? "Actual received amount is not yet verified."
                  : `Received ${action.asset}; verified from confirmed token balance changes.`}
              </p>
              <div className="result-rule" />
              <p className="eyebrow">ON-CHAIN TRANSACTION</p>
              {action.signature ? (
                <a
                  className="explorer"
                  href={`https://solscan.io/tx/${action.signature}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {short(action.signature)} ↗
                </a>
              ) : (
                <p>No transaction submitted</p>
              )}
              <p className="eyebrow">PROVIDER FILL</p>
              <p>{action.providerStatus ?? "No fill verified"}</p>
              <p className="muted small">
                This action is saved on the server. You can recover it after
                refreshing this browser. Keep the recovery token private.
              </p>
              <button
                className="secondary"
                onClick={() => {
                  const blob = new Blob(
                    [JSON.stringify({ id: action.id, token: action.token })],
                    { type: "application/json" },
                  );
                  const link = document.createElement("a");
                  link.href = URL.createObjectURL(blob);
                  link.download = "exitcheck-recovery.json";
                  link.click();
                  URL.revokeObjectURL(link.href);
                }}
              >
                Save recovery details
              </button>
              <label className="recovery-label">
                Restore another action
                <input
                  type="file"
                  accept="application/json"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const recovery = JSON.parse(await file.text());
                      persist(
                        await api<PreparedAction>(
                          `/api/actions/${recovery.id}`,
                          { token: recovery.token, operation: "status" },
                        ),
                      );
                    } catch {
                      setError("Recovery file could not be verified.");
                    }
                  }}
                />
              </label>
            </aside>
          </section>
        ) : selected ? (
          <>
            <button
              className="back-link"
              onClick={() => {
                setSelected(null);
                setView(null);
                setFixtureReview(false);
                previewSequence.current++;
              }}
            >
              <Arrow back /> All positions
            </button>
            <div className="exit-layout">
              <section className="exit-main">
                <div className="position-heading">
                  <span className={`status ${selected.state}`}>
                    {labels[selected.state]}
                  </span>
                  <span className="outcome">
                    {selected.isYes ? "YES" : "NO"}
                  </span>
                  <h2>{selected.title}</h2>
                  <p className="muted">
                    {decimal(selected.quantity)} contracts ·{" "}
                    {health?.mode === "fixture"
                      ? "Sample wallet"
                      : short(loadedOwner)}
                  </p>
                </div>
                {selected.state === "open" ? (
                  <>
                    <div className="size-control">
                      <div className="section-label">
                        <label htmlFor="quantity">
                          How much are you selling?
                        </label>
                        <span>
                          {quantity === decimal(selected.quantity)
                            ? "Full position"
                            : "Partial exit"}
                        </span>
                      </div>
                      <div className="quantity-input">
                        <input
                          id="quantity"
                          type="text"
                          inputMode="decimal"
                          value={quantity}
                          onChange={(e) => changeQuantity(e.target.value)}
                          aria-describedby="quantity-help"
                        />
                        <span>contracts</span>
                      </div>
                      <div className="size-shortcuts">
                        {[25n, 50n, 100n].map((n) => (
                          <button
                            key={String(n)}
                            className={
                              quantity ===
                              quantityAtPercent(selected.quantity, n)
                                ? "active"
                                : ""
                            }
                            onClick={() => shortcut(n)}
                          >
                            {String(n)}%
                          </button>
                        ))}
                        <small id="quantity-help">
                          Up to {decimal(selected.quantity)} available
                        </small>
                      </div>
                    </div>
                    <div className="section-label estimate-label">
                      <h3>Exit breakdown</h3>
                      <button
                        className="text-button"
                        disabled={!!busy}
                        onClick={() => void refresh()}
                      >
                        ↻{" "}
                        {busy === "preview"
                          ? "Refreshing…"
                          : "Refresh snapshot"}
                      </button>
                    </div>
                    <dl className="breakdown">
                      <Metric
                        label="Reference valuation"
                        value={
                          view?.estimate
                            ? money(view.estimate.referenceValue)
                            : "—"
                        }
                        note="Selected quantity × provider mark price"
                      />
                      <Metric
                        label="Estimated gross proceeds"
                        value={
                          view?.estimate ? money(view.estimate.gross, 6) : "—"
                        }
                        note="Selected outcome bids, highest price first"
                      />
                      <Metric
                        label="Provider fees"
                        value="Not yet verified"
                        note="Available in the unsigned order response"
                      />
                      <Metric
                        label="Average estimated sale price"
                        value={
                          view?.estimate
                            ? money(view.estimate.averagePrice, 6)
                            : "—"
                        }
                      />
                      <Metric
                        label="Available fill quantity"
                        value={
                          view?.estimate
                            ? `${decimal(view.estimate.fillable)} / ${decimal(view.estimate.requested)}`
                            : "—"
                        }
                        note="Contracts supported by this snapshot"
                      />
                      <Metric
                        label="Remaining position"
                        value={
                          view?.estimate
                            ? `${decimal(view.estimate.remaining)} contracts`
                            : "—"
                        }
                        note="Assuming the supported quantity fills"
                      />
                      <Metric
                        label="Price impact versus reference price"
                        value={
                          view?.estimate?.impactBps
                            ? `${decimal(BigInt(view.estimate.impactBps) * 10000n, 2)}%`
                            : "Not verified"
                        }
                        note={
                          view?.estimate
                            ? `Best available ${selected.isYes ? "YES" : "NO"} bid: ${money(view.estimate.impactReferencePrice, 6)}. Excludes fees and the mark-to-bid gap.`
                            : "Best available same-side bid; excludes fees and the mark-to-bid gap."
                        }
                      />
                    </dl>
                  </>
                ) : (
                  <div className="claim-information">
                    <h3>
                      {selected.state === "claimable"
                        ? "Your winning position can be claimed."
                        : selected.state === "awaiting-resolution"
                          ? "Waiting for a verified result."
                          : selected.state === "no-payout"
                            ? "This outcome has no payout."
                            : selected.state === "claimed"
                              ? "This payout has already been claimed."
                              : "This position cannot be verified for an exit."}
                    </h3>
                    <p>
                      {selected.state === "claimable"
                        ? "The resolved outcome matches your position. Each winning contract pays $1, with no provider claim fee. The network fee is separate."
                        : selected.state === "awaiting-resolution"
                          ? "Trading has stopped or the winning payout is not yet claimable. Refresh to check settlement; no sale or claim is currently available."
                          : selected.state === "no-payout"
                            ? "The market resolved against the selected outcome. No sale or winning claim is available."
                            : (selected.reason ??
                              "Forecast, cancelled markets, and unrecognized market states are outside this release’s supported workflow.")}
                    </p>
                    <dl className="breakdown">
                      <Metric
                        label="Market result"
                        value={
                          view?.market.result?.toUpperCase() ?? "Not resolved"
                        }
                      />
                      <Metric
                        label="Your outcome"
                        value={selected.isYes ? "YES" : "NO"}
                      />
                      <Metric
                        label="Claim eligibility"
                        value={
                          selected.state === "claimable"
                            ? "Eligible"
                            : "Unavailable"
                        }
                      />
                      <Metric
                        label="Expected payout"
                        value={
                          selected.state === "claimable"
                            ? money(selected.payout, 6)
                            : selected.state === "no-payout"
                              ? "$0.00"
                              : "Not verified"
                        }
                      />
                      <Metric
                        label="Receiving asset"
                        value="USDC or JupUSD — verify in transaction"
                      />
                    </dl>
                    <button
                      className="text-button"
                      disabled={!!busy}
                      onClick={() => void refresh()}
                    >
                      ↻ Refresh resolution status
                    </button>
                  </div>
                )}
                <div className="market-strip">
                  <span>
                    Market <strong>{view?.market.status ?? "Checking…"}</strong>
                  </span>
                  <span>
                    Exchange{" "}
                    <strong>
                      {view
                        ? view.tradingActive
                          ? "Trading active"
                          : "Trading paused"
                        : "Checking…"}
                    </strong>
                  </span>
                </div>
              </section>
              <aside className="proceeds-panel">
                <p className="eyebrow">
                  {selected.state === "claimable"
                    ? "EXPECTED WINNING PAYOUT"
                    : "ESTIMATED PROCEEDS"}
                </p>
                <div className="proceeds-number">
                  {selected.state === "claimable"
                    ? money(selected.payout)
                    : view?.estimate
                      ? money(view.estimate.gross)
                      : "—"}
                </div>
                <span className="proceeds-subtitle">
                  {selected.state === "claimable"
                    ? "Before the Solana network fee"
                    : view?.estimate
                      ? "Before fees · order-book estimate"
                      : "Refresh to calculate this size"}
                </span>
                <div className="panel-rule" />
                <div className="net-row">
                  <span>Net proceeds</span>
                  <strong>
                    {selected.state === "claimable"
                      ? money(selected.payout)
                      : "Not yet verified"}
                  </strong>
                </div>
                <p className="muted small">
                  {selected.state === "claimable"
                    ? "No provider claim fee. The receiving asset and network fee must be reviewed before signing."
                    : "Fees and an executable provider quote are checked during transaction preparation. This snapshot does not promise a fill."}
                </p>
                {stale && (
                  <div className="notice warning">
                    <strong>Snapshot expired</strong>
                    <p>Refresh before reviewing an exit.</p>
                  </div>
                )}
                {view?.estimate?.insufficient && (
                  <div className="notice warning">
                    <strong>Insufficient depth for this size</strong>
                    <p>
                      Only {decimal(view.estimate.fillable)} of{" "}
                      {decimal(view.estimate.requested)} contracts are
                      supported. Reduce your sale quantity.
                    </p>
                  </div>
                )}
                {selected.state === "open" && (
                  <label className="minimum-input">
                    Minimum acceptable sale price
                    <input
                      inputMode="decimal"
                      placeholder="e.g. 0.60 per contract"
                      value={minimum}
                      onChange={(e) => setMinimum(e.target.value)}
                    />
                    <small>
                      The returned provider floor must meet this value. We never
                      widen it.
                    </small>
                  </label>
                )}
                {actionable && (
                  <button
                    className="primary full-width"
                    disabled={
                      !!busy ||
                      !view ||
                      stale ||
                      !!view.estimate?.insufficient ||
                      (selected.state === "open" && !view.tradingActive) ||
                      (health?.mode !== "fixture" && !ownerMatches)
                    }
                    onClick={() => void prepare()}
                  >
                    {busy === "prepare"
                      ? "Preparing…"
                      : health?.mode === "fixture"
                        ? "Review fixture estimate"
                        : selected.state === "claimable"
                          ? "Prepare claim"
                          : "Review exit"}{" "}
                    <Arrow />
                  </button>
                )}
                {health?.mode !== "fixture" && actionable && !ownerMatches && (
                  <p className="small muted">
                    Connect {short(loadedOwner)} to prepare this action.
                  </p>
                )}
                <div className="snapshot">
                  <span className={`dot ${stale ? "amber" : ""}`} />
                  <span>
                    {view?.estimate
                      ? `Snapshot received at ${new Date(view.estimate.capturedAt).toLocaleTimeString(undefined, { timeZone: "UTC", hour12: false })} UTC · ${stale ? "stale" : `${Math.max(0, Math.floor((now - view.estimate.capturedAt) / 1000))}s ago`}`
                      : "No liquidity snapshot"}
                  </span>
                </div>
                <div className="trust-note">
                  <span aria-hidden="true">↳</span>
                  <p>
                    Your wallet stays in control.
                    <br />
                    Nothing moves until you review and sign.
                  </p>
                </div>
              </aside>
            </div>
            {fixtureReview && (
              <section className="fixture-review" aria-label="Fixture review">
                <p className="eyebrow">DEVELOPMENT FIXTURE · REVIEW</p>
                <h2>Review the estimate, with its limits.</h2>
                <p>
                  Sell {decimal(view?.estimate?.requested ?? "0")}{" "}
                  {selected.isYes ? "YES" : "NO"} contracts. Estimated gross
                  proceeds: {money(view?.estimate?.gross ?? null, 6)}. Provider
                  fees, receiving mint, and executable bounds have not been
                  verified.
                </p>
                <div className="notice warning">
                  <strong>No transaction exists</strong>
                  <p>
                    This fixture exercises position selection and estimate
                    review. It cannot demonstrate a wallet signature, a fill, or
                    a confirmed claim.
                  </p>
                </div>
                <button
                  className="secondary"
                  onClick={() => setFixtureReview(false)}
                >
                  Back to preview
                </button>
              </section>
            )}
          </>
        ) : positions ? (
          <section className="positions-section">
            <div className="positions-toolbar">
              <div className="tabs" role="group" aria-label="Filter positions">
                {[
                  ["all", "All positions"],
                  ["open", "Open"],
                  ["claimable", "Claimable"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    className={filter === key ? "active" : ""}
                    onClick={() => setFilter(key)}
                  >
                    {label}
                    {key === "all" && <span>{positions.length}</span>}
                  </button>
                ))}
              </div>
              <button
                className="text-button"
                onClick={() => void lookup(loadedOwner)}
                disabled={!!busy}
              >
                ↻ Refresh positions
              </button>
            </div>
            <div className="wallet-line">
              <span>
                {health?.mode === "fixture"
                  ? "Sample wallet"
                  : short(loadedOwner)}
              </span>
              <span>Public-address lookup · read only</span>
              <button
                className="text-button"
                onClick={() => {
                  setPositions(null);
                  setLoadedOwner("");
                }}
              >
                Change wallet
              </button>
            </div>
            {filtered?.length === 0 ? (
              <div className="empty-state">
                <span className="empty-symbol" aria-hidden="true">
                  ∅
                </span>
                <h2>
                  {positions.length === 0
                    ? "No Jupiter positions found."
                    : "No positions in this view."}
                </h2>
                <p>
                  Only supported Jupiter Prediction positions are covered. An
                  empty lookup does not describe all assets in this wallet.
                </p>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="positions-table">
                  <thead>
                    <tr>
                      <th>Market / outcome</th>
                      <th>Contracts</th>
                      <th>Status</th>
                      <th>Displayed value</th>
                      <th>
                        <span className="sr-only">Action</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered?.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.title}</strong>
                          <span className="outcome small-outcome">
                            {p.isYes ? "YES" : "NO"}
                          </span>
                        </td>
                        <td data-label="Contracts">{decimal(p.quantity)}</td>
                        <td data-label="Status">
                          <span className={`status ${p.state}`}>
                            {labels[p.state]}
                          </span>
                        </td>
                        <td data-label="Displayed value">
                          {p.value === null ? "—" : money(p.value)}
                          <small>
                            {p.value === null
                              ? "No active mark valuation"
                              : "Provider mark-to-market"}
                          </small>
                        </td>
                        <td>
                          <button
                            className="row-action"
                            onClick={() => select(p)}
                          >
                            {p.state === "claimable"
                              ? "View claim"
                              : p.state === "open"
                                ? "Check exit"
                                : "View details"}{" "}
                            <Arrow />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="table-note">
              Displayed value is a reference valuation. Your executable proceeds
              depend on size, available bids, and fees.
            </p>
          </section>
        ) : (
          <div className="entry-layout">
            <section className="lookup-panel">
              <div className="section-label">
                <h2>Find your position</h2>
                <span className="read-only-label">READ ONLY</span>
              </div>
              <p className="muted">
                Connect your wallet or look up a public Solana address. No
                signature is needed to check positions.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void lookup();
                }}
              >
                <label htmlFor="wallet-address">Wallet address</label>
                <input
                  id="wallet-address"
                  className="address-input"
                  value={owner}
                  onChange={(e) => setOwner(e.target.value.trim())}
                  placeholder="Paste a Solana public address"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  className="primary full-width"
                  type="submit"
                  disabled={!!busy || !owner}
                >
                  {busy === "lookup"
                    ? "Checking positions…"
                    : "Check positions"}{" "}
                  <Arrow />
                </button>
              </form>
              <div className="or-divider">
                <span>or use your connected wallet</span>
              </div>
              {wallet.publicKey ? (
                <button
                  className="secondary full-width"
                  onClick={() => void lookup(wallet.publicKey!.toBase58())}
                >
                  Look up {short(wallet.publicKey.toBase58())} <Arrow />
                </button>
              ) : (
                <WalletMultiButton>Connect wallet</WalletMultiButton>
              )}
              {health?.mode === "fixture" && (
                <button
                  className="secondary full-width sample-button"
                  onClick={() =>
                    void lookup("11111111111111111111111111111111")
                  }
                >
                  Load sample positions <Arrow />
                </button>
              )}
              <div className="coverage">
                <span className="provider-monogram">J</span>
                <div>
                  <strong>Jupiter Prediction</strong>
                  <p>Keeper-filled YES / NO positions and winning claims</p>
                </div>
                <span className="coverage-tag">SUPPORTED</span>
              </div>
              {health?.status === "setup-required" && (
                <div className="notice warning setup-message">
                  <strong>Provider setup required</strong>
                  <p>{health.setup}</p>
                  <details>
                    <summary>Local setup</summary>
                    <p>
                      Set JUPITER_API_KEY in .env.local. Set SOLANA_RPC_URL for
                      unsigned transaction simulation. Restart the development
                      server. Development fixtures are available with npm run
                      dev:fixture.
                    </p>
                  </details>
                </div>
              )}
            </section>
            <aside className="explanation-panel">
              <p className="eyebrow">VALUE ISN’T ALWAYS PROCEEDS.</p>
              <h2>
                A position has a price.
                <br />
                An exit has a size.
              </h2>
              <p>
                ExitCheck follows the bids for the quantity you want to sell,
                then makes the costs and constraints visible.
              </p>
              <div
                className="worksheet"
                aria-label="What the exit preview checks"
              >
                <div className="worksheet-title">
                  <span>YOUR EXIT, UNPACKED</span>
                  <span aria-hidden="true">↗</span>
                </div>
                <div>
                  <span>Displayed position value</span>
                  <span>Reference</span>
                </div>
                <div>
                  <span>Available bids for your size</span>
                  <span>Liquidity</span>
                </div>
                <div>
                  <span>Provider & network costs</span>
                  <span>Deductions</span>
                </div>
                <div className="worksheet-total">
                  <strong>What you can receive</strong>
                  <strong>Exit estimate</strong>
                </div>
              </div>
              <div className="workflow">
                <div>
                  <span>01</span>
                  <p>Identify your position</p>
                </div>
                <div>
                  <span>02</span>
                  <p>Check your sale size</p>
                </div>
                <div>
                  <span>03</span>
                  <p>Review, sign & track</p>
                </div>
              </div>
              <p className="scope-note">
                For existing positions only. No bet recommendations or outcome
                predictions.
              </p>
            </aside>
          </div>
        )}
        <footer>
          <span>
            ExitCheck <span className="footer-divider">/</span> Clarity before
            you sign.
          </span>
          <span>Estimates can change. Liquidity is never guaranteed.</span>
          <a
            href="https://developers.jup.ag/docs/prediction/trading-lifecycle"
            target="_blank"
            rel="noreferrer"
          >
            Provider documentation ↗
          </a>
        </footer>
      </main>
      {how && (
        <div className="modal-backdrop" onClick={() => setHow(false)}>
          <section
            className="how-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="how-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="Close how it works"
              onClick={() => setHow(false)}
            >
              ×
            </button>
            <p className="eyebrow">HOW IT WORKS</p>
            <h2 id="how-title">From position to proceeds.</h2>
            <ol>
              <li>
                <strong>Find an existing position.</strong>
                <p>
                  Use a public address or connect a wallet. Coverage is limited
                  to supported Jupiter Prediction positions.
                </p>
              </li>
              <li>
                <strong>Choose the quantity.</strong>
                <p>
                  The estimate walks the selected outcome’s bids from the best
                  available price. Fees remain unknown until an order is
                  prepared.
                </p>
              </li>
              <li>
                <strong>Review a fresh transaction.</strong>
                <p>
                  Verify the owner, network, execution floor, asset, and costs.
                  Signing requires all release and execution checks.
                </p>
              </li>
              <li>
                <strong>Track the actual result.</strong>
                <p>
                  On-chain confirmation creates a keeper order. A pending or
                  partial fill is not a completed exit.
                </p>
              </li>
            </ol>
            <button className="primary" onClick={() => setHow(false)}>
              Back to workspace <Arrow />
            </button>
          </section>
        </div>
      )}
    </>
  );
}
