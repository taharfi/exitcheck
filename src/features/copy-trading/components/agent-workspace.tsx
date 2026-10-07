"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { AccountConnection } from "@/features/account/components/account-connection";
import { decimal, money, decimalToMicro } from "@/lib/amounts";
import { address } from "@/lib/provider/schemas";
import type { AgentSnapshot, AgentDecision } from "../agent-model";
import { AgentEntryReview } from "./agent-entry-review";
import { AgentJournal } from "./agent-journal";
import { AgentMonitoring } from "./agent-monitoring";
import { TraderActivityPreview } from "./trader-activity-preview";
import styles from "./agent.module.css";

const short = (value: string) => value.slice(0, 6) + "…" + value.slice(-5);
const time = (value: number | null) =>
  value === null ? "Not checked yet" : new Date(value).toLocaleString();
const labels: Record<AgentDecision["status"], string> = {
  review: "Review needed",
  skipped: "Skipped",
  exit_signal: "Exit detected",
  dismissed: "Dismissed",
  expired: "Expired",
};

export function AgentWorkspace() {
  const [snapshot, setSnapshot] = useState<AgentSnapshot | null>(null);
  const [trader, setTrader] = useState("");
  const [budget, setBudget] = useState("100");
  const [entry, setEntry] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState(0);
  const generation = useRef(0),
    abort = useRef<AbortController | null>(null),
    working = useRef(false);
  const load = useCallback(async () => {
    const sequence = ++generation.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    try {
      const response = await fetch("/api/agent", {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
        }),
        data = await response.json();
      if (!response.ok)
        throw Error(data.error?.message ?? "Agent status unavailable.");
      if (sequence === generation.current && !controller.signal.aborted) {
        setSnapshot(data);
        setCheckedAt(Date.now());
      }
    } catch (e) {
      if (sequence === generation.current && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Agent status unavailable.");
    }
  }, []);
  const cancel = useCallback(() => {
    generation.current++;
    abort.current?.abort();
  }, []);
  useEffect(() => {
    let mounted = true;
    void Promise.resolve().then(() => {
      if (!mounted) return;
      const value = new URLSearchParams(window.location.search).get("trader");
      if (value && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value))
        setTrader(value);
      const proposedBudget = new URLSearchParams(window.location.search).get(
        "budget",
      );
      if (proposedBudget && /^\d{1,7}(\.\d{1,2})?$/.test(proposedBudget)) {
        const amount = decimalToMicro(proposedBudget);
        if (amount >= 25000000n && amount <= 1000000000000n) {
          setBudget(proposedBudget);
          const size = amount / 10n;
          setEntry(
            decimal(
              size < 5000000n
                ? 5000000n
                : size > 500000000n
                  ? 500000000n
                  : size,
              2,
            ),
          );
        }
      }
      void load();
    });
    const timer = setInterval(() => {
      setCheckedAt(Date.now());
      if (!working.current) void load();
    }, 10000);
    const changed = () => {
      setSnapshot(null);
      void load();
    };
    window.addEventListener("exitcheck-account", changed);
    return () => {
      mounted = false;
      cancel();
      clearInterval(timer);
      window.removeEventListener("exitcheck-account", changed);
    };
  }, [load, cancel]);
  async function act(
    action: "start" | "pause" | "resume" | "stop" | "refresh" | "dismiss",
    decisionId?: string,
  ) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    const sequence = ++generation.current;
    abort.current?.abort();
    try {
      const payload =
        action === "start"
          ? { action, settings: { trader: trader.trim(), budget, entry } }
          : {
              action,
              planId: snapshot?.plan?.id,
              ...(decisionId ? { decisionId } : {}),
            };
      const response = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(90000),
        }),
        data = await response.json();
      if (!response.ok)
        throw Error(
          data.error?.message ?? "The agent plan could not be updated.",
        );
      if (sequence === generation.current) {
        setSnapshot(data);
        setCheckedAt(Date.now());
      }
    } catch (e) {
      if (sequence === generation.current)
        setError(
          e instanceof Error
            ? e.message
            : "The agent plan could not be updated.",
        );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  const plan = snapshot?.plan,
    ended =
      !!plan && (plan.status === "stopped" || plan.expiresAt <= checkedAt);
  const decisions: AgentDecision[] =
    snapshot?.decisions.map((decision): AgentDecision =>
      decision.status === "review" && decision.expiresAt <= checkedAt
        ? {
            ...decision,
            status: "expired",
            reason:
              "This proposal expired. A fresh quote and execution review would be required.",
          }
        : decision,
    ) ?? [];
  const reviews = decisions.filter((d) => d.status === "review");
  const overdue =
    !!plan?.lastSuccess &&
    plan.status === "watching" &&
    checkedAt - plan.lastSuccess > 90000;
  const planningAmount = /^\d{1,7}(\.\d{1,2})?$/.test(budget)
    ? decimalToMicro(budget)
    : null;
  const entryAmount = /^\d{1,5}(\.\d{1,2})?$/.test(entry)
    ? decimalToMicro(entry)
    : null;
  const validBudget =
    planningAmount !== null &&
    planningAmount >= 25000000n &&
    planningAmount <= 1000000000000n;
  const validEntry =
    entryAmount !== null &&
    entryAmount >= 5000000n &&
    entryAmount <= 500000000n &&
    (!validBudget || entryAmount <= planningAmount! / 5n);
  const validAmounts = validBudget && validEntry;
  const validTrader = address.safeParse(trader.trim()).success;
  const activePlan = !!plan && !ended;
  const currentStep = activePlan
    ? plan.status === "watching" && plan.cursor
      ? 4
      : 3
    : !validTrader
      ? 1
      : !validAmounts
        ? 2
        : 3;
  const nextStep = !snapshot
    ? {
        title: error
          ? "Your plan could not be loaded"
          : "Loading your saved plan",
        reason: error
          ? "Use Reload status below to try again."
          : "Your private plan will appear after your account is checked.",
        href: null,
        action: "",
      }
    : activePlan
      ? plan.status === "paused"
        ? {
            title: "Your plan is paused",
            reason:
              "Resume watching to look for new fills. Activity during the pause will not become proposals.",
            href: "#setup-heading",
            action: "View plan controls",
          }
        : !snapshot.collectorEnabled
          ? {
              title: "Monitoring is unavailable",
              reason:
                "Your saved plan is still here. Watching can continue when monitoring is available again.",
              href: "#activity-heading",
              action: "View status",
            }
          : !plan.cursor && !plan.error
            ? {
                title: "Getting your starting point",
                reason:
                  "The first successful check records existing trades. Only new fills after that point can become proposals.",
                href: "#activity-heading",
                action: "View activity",
              }
            : overdue || plan.error
              ? {
                  title: "Check your monitoring status",
                  reason:
                    "Recent activity may be delayed or missing. Check the status before relying on a proposal.",
                  href: "#activity-heading",
                  action: "View status",
                }
              : reviews.length
                ? {
                    title: "You have proposals to review",
                    reason:
                      "Check the latest price, wallet budget and exit coverage. A proposal is not a trade; approval is unavailable.",
                    href: "#activity-heading",
                    action: "Review proposals",
                  }
                : {
                    title: "Watching for the next trade",
                    reason:
                      "Hosted monitoring can continue while your plan is active, even after you leave this page. Check the last source-check time when you return. New fills may create proposals or explain skips.",
                    href: "#activity-heading",
                    action: "View activity",
                  }
      : !validTrader
        ? {
            title: "Choose one trader",
            reason: trader.trim()
              ? "Enter a valid Solana public wallet address, or choose a trader from discovery."
              : "Explore public trader records, then bring one wallet here. A high reported profit alone does not prove they are a good trader to copy.",
            href: "/discover",
            action: "Find a trader",
          }
        : !validAmounts
          ? {
              title: "Adjust your planning budget",
              reason:
                "Use $25–$1,000,000 for the budget and $5–$500 per entry, within 20% of that budget.",
              href: validBudget ? "#agent-entry" : "#agent-budget",
              action: "Adjust limits",
            }
          : !snapshot.signedIn
            ? {
                title: "Sign in to save your plan",
                reason:
                  "Connect your wallet and approve the login message. No deposit is required and signing in does not authorize trading.",
                href: "#agent-account",
                action: "Go to sign-in",
              }
            : !snapshot.collectorEnabled || !snapshot.providerConfigured
              ? {
                  title: "Watching is temporarily unavailable",
                  reason:
                    "You can still explore public traders. Try starting your plan again when the service is available.",
                  href: "/discover",
                  action: "Explore traders",
                }
              : {
                  title: "Your plan is ready to watch",
                  reason:
                    "Starting records a baseline, then watches for new fills. Your budget is a planning limit; no money is deposited or traded.",
                  href: "#setup-heading",
                  action: "Review and start",
                };
  return (
    <>
      <AppHeader badge="BETA" />
      <main className={"paper-main " + styles.main}>
        <section className={styles.intro}>
          <div>
            <p className="eyebrow">COPY AGENT · STAGE 1</p>
            <h1>
              Follow a trader.
              <br />
              Check every move.
            </h1>
            <p>
              Watch new filled trades and review entries within your planning
              budget. This stage prepares proposals; it does not place orders.
            </p>
          </div>
          <span className={styles.mode}>Observation only</span>
        </section>
        <nav className={styles.journey} aria-label="Copy trading steps">
          <a
            href={activePlan ? "/discover" : "#agent-trader"}
            aria-current={currentStep === 1 ? "step" : undefined}
          >
            1. Choose a trader
          </a>
          <a
            href="#setup-heading"
            aria-current={currentStep === 2 ? "step" : undefined}
          >
            2. Set your budget
          </a>
          <a
            href="#setup-heading"
            aria-current={currentStep === 3 ? "step" : undefined}
          >
            3. Start watching
          </a>
          <a
            href="#activity-heading"
            aria-current={currentStep === 4 ? "step" : undefined}
          >
            4. Review the results
          </a>
        </nav>
        <section className={styles.nextStep} aria-label="Your next step">
          <div>
            <p className="eyebrow">YOUR NEXT STEP</p>
            <h2>{nextStep.title}</h2>
            <p>{nextStep.reason}</p>
          </div>
          {nextStep.href && (
            <Link href={nextStep.href}>{nextStep.action} →</Link>
          )}
        </section>
        <div id="agent-account">
          <AccountConnection context="agent" />
        </div>
        {error && (
          <div role="alert" className={styles.error}>
            <strong>Could not complete this step</strong>
            <p>{error}</p>
            <button
              type="button"
              onClick={() => {
                setError("");
                void load();
              }}
            >
              Reload status
            </button>
          </div>
        )}
        <div className={styles.layout}>
          <section className={styles.setup} aria-labelledby="setup-heading">
            <p className="eyebrow">ONE TRADER. ONE PLAN.</p>
            <h2 id="setup-heading">
              {plan && !ended ? "Your agent plan" : "Set up your agent"}
            </h2>
            {plan && !ended ? (
              <>
                <div className={styles.trader}>
                  <span>Following</span>
                  <strong title={plan.trader}>{short(plan.trader)}</strong>
                </div>
                <TraderActivityPreview key={plan.trader} trader={plan.trader} />
                <dl className={styles.facts}>
                  <div>
                    <dt>Planning budget</dt>
                    <dd>{money(plan.budget)}</dd>
                  </div>
                  <div>
                    <dt>Per entry</dt>
                    <dd>{money(plan.entry)}</dd>
                  </div>
                  <div>
                    <dt>Pending allocations</dt>
                    <dd>{money(snapshot?.reserved ?? "0")}</dd>
                  </div>
                  <div>
                    <dt>Mode</dt>
                    <dd>Proposals only</dd>
                  </div>
                </dl>
                <p className={styles.note}>
                  The planning budget is a limit you chose. It is not a verified
                  wallet balance, deposit or reservation of funds.
                </p>
                <div className={styles.controls}>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      !snapshot?.signedIn ||
                      !snapshot.collectorEnabled ||
                      plan.status !== "watching" ||
                      (plan.lastPoll !== null &&
                        checkedAt - plan.lastPoll < 15000)
                    }
                    onClick={() => void act("refresh")}
                  >
                    Check new activity
                  </button>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      !snapshot?.signedIn ||
                      (plan.status === "paused" && !snapshot.collectorEnabled)
                    }
                    onClick={() =>
                      void act(plan.status === "watching" ? "pause" : "resume")
                    }
                  >
                    {plan.status === "watching"
                      ? "Pause watching"
                      : "Resume watching"}
                  </button>
                  <button
                    type="button"
                    disabled={busy || !snapshot?.signedIn}
                    onClick={() => void act("stop")}
                  >
                    Stop plan
                  </button>
                </div>
                {plan.status === "paused" && (
                  <p className={styles.note}>
                    Resuming sets a new baseline. Activity from the paused
                    period will not become copy proposals.
                  </p>
                )}
              </>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void act("start");
                }}
              >
                <label htmlFor="agent-trader">Trader wallet</label>
                <input
                  id="agent-trader"
                  value={trader}
                  disabled={!snapshot || busy}
                  onChange={(event) => setTrader(event.target.value)}
                  placeholder="Paste a Solana public address"
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby="agent-trader-help"
                  aria-invalid={!!trader.trim() && !validTrader}
                />
                <p id="agent-trader-help" className={styles.note}>
                  Paste the public address of the trader you want to follow.
                  Your own wallet is connected separately for sign-in.
                </p>
                <Link href="/discover" className={styles.smallLink}>
                  Find a trader →
                </Link>
                <TraderActivityPreview
                  key={trader.trim()}
                  trader={trader.trim()}
                />
                <div className={styles.amountInputs}>
                  <div>
                    <label htmlFor="agent-budget">Planning budget (USD)</label>
                    <input
                      id="agent-budget"
                      inputMode="decimal"
                      value={budget}
                      disabled={!snapshot || busy}
                      onChange={(event) => setBudget(event.target.value)}
                      aria-invalid={!validBudget}
                    />
                  </div>
                  <div>
                    <label htmlFor="agent-entry">Amount per entry (USD)</label>
                    <input
                      id="agent-entry"
                      inputMode="decimal"
                      value={entry}
                      disabled={!snapshot || busy}
                      onChange={(event) => setEntry(event.target.value)}
                      aria-invalid={!validEntry}
                    />
                  </div>
                </div>
                <div className={styles.controls} aria-label="Budget presets">
                  {[50, 100, 250].map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      disabled={busy || !snapshot}
                      aria-pressed={
                        budget === String(amount) &&
                        entry === String(amount / 10)
                      }
                      onClick={() => {
                        setBudget(String(amount));
                        setEntry(String(amount / 10));
                      }}
                    >
                      ${amount}
                    </button>
                  ))}
                </div>
                {validAmounts && (
                  <p className={styles.note}>
                    Plan preview: {money(entryAmount!.toString())} per entry. Up
                    to {money(((planningAmount! * 80n) / 100n).toString())}{" "}
                    allocated across pending proposals and held position cost;{" "}
                    {money((planningAmount! / 5n).toString())} per event. No
                    deposit or order is made.
                  </p>
                )}
                {!validAmounts && (
                  <p role="status" className={styles.warning}>
                    Set a budget of $25–$1,000,000 and an entry of $5–$500, no
                    more than 20% of your budget.
                  </p>
                )}
                <p className={styles.note}>
                  Budget: $25–$1,000,000. Entries: $5–$500, up to 20% of the
                  budget. These are proposal limits, not verified execution
                  costs.
                </p>
                <button
                  type="submit"
                  className={styles.primary}
                  disabled={
                    busy ||
                    !snapshot?.signedIn ||
                    !snapshot.collectorEnabled ||
                    !snapshot.providerConfigured ||
                    !validAmounts ||
                    !validTrader
                  }
                >
                  {busy ? "Setting the baseline…" : "Start watching"}
                  <span aria-hidden="true">↗</span>
                </button>
                <p className={styles.note}>
                  What happens next: record existing trades, watch for new
                  fills, then review proposals and skips. No orders are placed.
                </p>
                {!snapshot?.signedIn && (
                  <p className={styles.note}>
                    Sign in above to save your private plan. Login does not
                    authorize trades.
                  </p>
                )}
                {snapshot && !snapshot.collectorEnabled && (
                  <p role="status" className={styles.note}>
                    Agent observation is disabled on this server.
                  </p>
                )}
                {snapshot && !snapshot.providerConfigured && (
                  <p role="status" className={styles.note}>
                    Jupiter access needs configuration before real activity can
                    be collected.
                  </p>
                )}
              </form>
            )}
            <details className={styles.limits}>
              <summary>Proposal rules and execution limits</summary>
              <ul>
                <li>Only new fills after the baseline are considered.</li>
                <li>Signals expire after two minutes.</li>
                <li>
                  Indicative entry price may be at most 3% above the source
                  price.
                </li>
                <li>
                  Pending proposals can allocate 80% of the budget and 20% per
                  event.
                </li>
                <li>
                  Initial proposals exclude wallet exposure. The on-demand
                  wallet review checks funds and held cost before fees;
                  executable buy depth and fees remain unverified.
                </li>
                <li>
                  Trade signing and submission remain unavailable. Each future
                  approval requires fresh execution checks.
                </li>
              </ul>
            </details>
          </section>
          <section
            className={styles.activity}
            aria-labelledby="activity-heading"
          >
            <div className={styles.activityHeading}>
              <div>
                <p className="eyebrow">OBSERVE BEFORE EXECUTING</p>
                <h2 id="activity-heading">Agent activity</h2>
              </div>
              <span className={styles.state}>
                {!plan
                  ? "Not started"
                  : ended
                    ? "Ended"
                    : !snapshot?.collectorEnabled
                      ? "Collector offline"
                      : plan.status === "watching"
                        ? "Watching"
                        : "Paused"}
              </span>
            </div>
            {plan && (
              <div className={styles.health}>
                <div>
                  <span>Last source check</span>
                  <strong>{time(plan.lastSuccess)}</strong>
                </div>
                <div>
                  <span>Ready for review</span>
                  <strong>
                    {reviews.length}{" "}
                    {reviews.length === 1 ? "proposal" : "proposals"}
                  </strong>
                </div>
              </div>
            )}
            {plan?.error && (
              <div className={styles.warning} role="alert">
                {plan.error}
              </div>
            )}
            {overdue && (
              <p className={styles.warning}>
                The last successful source check is overdue. Activity may be
                delayed or missing.
              </p>
            )}
            {plan && !plan.cursor && !plan.error && (
              <p className={styles.note}>
                Waiting for the first successful history check to establish a
                baseline.
              </p>
            )}
            {decisions.length ? (
              <div className={styles.decisions}>
                {decisions.map((decision) => (
                  <article className={styles.decision} key={decision.id}>
                    <div className={styles.decisionHeading}>
                      <span
                        className={styles.decisionStatus}
                        data-state={decision.status}
                      >
                        {labels[decision.status]}
                      </span>
                      <time
                        dateTime={new Date(decision.observedAt).toISOString()}
                      >
                        {new Date(decision.observedAt).toLocaleTimeString()}
                      </time>
                    </div>
                    <h3>{decision.title}</h3>
                    <p className={styles.side}>
                      {decision.action === "buy" ? "Bought" : "Sold"}{" "}
                      {decision.side.toUpperCase()} ·{" "}
                      {decimal(decision.leaderContracts)} source contracts
                    </p>
                    <div className={styles.prices}>
                      <div>
                        <span>Trader fill price</span>
                        <strong>{money(decision.leaderPrice, 4)}</strong>
                      </div>
                      <div>
                        <span>Indicative buy quote</span>
                        <strong>{money(decision.quotePrice, 4)}</strong>
                      </div>
                      {decision.allocation !== "0" && (
                        <div>
                          <span>Planned entry</span>
                          <strong>{money(decision.allocation)}</strong>
                        </div>
                      )}
                    </div>
                    <p className={styles.reason}>{decision.reason}</p>
                    {decision.status === "review" &&
                      plan?.status === "watching" &&
                      !ended &&
                      snapshot?.signedIn && (
                        <AgentEntryReview
                          planId={plan.id}
                          decisionId={decision.id}
                          checkedAt={checkedAt}
                          onSaved={() => void load()}
                        />
                      )}
                    {decision.status === "review" && (
                      <div className={styles.reviewControls}>
                        <button type="button" disabled>
                          Trade approval unavailable
                        </button>
                        <button
                          type="button"
                          disabled={busy || !snapshot?.signedIn}
                          onClick={() => void act("dismiss", decision.id)}
                        >
                          Dismiss proposal
                        </button>
                        <small>
                          Expires{" "}
                          {new Date(decision.expiresAt).toLocaleTimeString()}.
                          No funds are reserved.
                        </small>
                      </div>
                    )}
                    {decision.status === "exit_signal" && (
                      <Link href="/app" className={styles.smallLink}>
                        Inspect your positions and exit liquidity →
                      </Link>
                    )}
                    <details className={styles.source}>
                      <summary>Source details</summary>
                      <p>
                        Event {decision.sourceId} · {time(decision.sourceAt)}
                        <br />
                        Observed {time(decision.observedAt)}
                        <br />
                        Quote retrieved {time(decision.quoteAt)}
                      </p>
                      {decision.sourceSignature && (
                        <a
                          href={
                            "https://solscan.io/tx/" + decision.sourceSignature
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View reported source transaction ↗
                        </a>
                      )}
                      <p>
                        Reported by Jupiter; independently confirming this fill
                        remains an execution prerequisite.
                      </p>
                    </details>
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.empty}>
                <span aria-hidden="true">⌁</span>
                <h3>
                  {ended
                    ? "This observation has ended."
                    : plan?.status === "paused"
                      ? "Watching is paused."
                      : plan
                        ? "Waiting for new filled trades."
                        : "Your trader’s next move starts here."}
                </h3>
                <p>
                  {ended
                    ? "Start a new plan to watch again. Its first check will establish a fresh baseline."
                    : plan?.status === "paused"
                      ? "Resume your plan to look for new fills. Trades from the paused period will not become proposals."
                      : plan
                        ? "No new proposal yet. The initial history is a baseline, not old trades to copy. New fills may create proposals or be skipped because they exceed your limits. Check the source-check time to confirm monitoring is current."
                        : "Choose one wallet and set a planning budget. The agent will explain preliminary entries, skipped opportunities and detected exits."}
                </p>
              </div>
            )}
            <p className={styles.coverage}>
              {snapshot?.coverage ?? "Loading observation status…"}
            </p>
          </section>
        </div>
        {snapshot?.signedIn && snapshot.monitoring && (
          <AgentMonitoring report={snapshot.monitoring} stale={overdue} />
        )}
        {snapshot?.signedIn && (
          <AgentJournal entries={snapshot.journal ?? []} />
        )}
      </main>
    </>
  );
}
