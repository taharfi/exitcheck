"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppHeader } from "@/components/app-header";
import { decimal, money } from "@/lib/amounts";
import {
  marketFeedSchema,
  researchSchema,
  type MarketItem,
  type ResearchResult,
} from "./types";
import {
  emptyPaperAccount,
  executePaperOrder,
  paperAccountSchema,
  paperQuote,
  STORAGE_KEY,
  type PaperAccount,
  type PaperPosition,
} from "./paper";
import styles from "./terminal.module.css";
import { z } from "zod";
const percent = (n: number | null) =>
  n === null ? "—" : `${(n * 100).toFixed(1)}%`;
const dollars = (n: number | null) =>
  n === null
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(n);
const date = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("exitcheck-paper", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("exitcheck-paper", callback);
  };
}
function snapshot() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return "storage-unavailable";
  }
}
const serverSnapshot = () => null;
const readySubscribe = () => () => {};
async function api(
  url: string,
  data?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const r = await fetch(url, {
    method: data === undefined ? "GET" : "POST",
    ...(data === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }),
    signal,
  });
  const value: unknown = await r.json();
  if (!r.ok) {
    const error = z
      .object({ error: z.object({ message: z.string() }) })
      .safeParse(value);
    throw Error(
      error.success
        ? error.data.error.message
        : "Request failed. Please retry.",
    );
  }
  return value;
}
function readAccount(): PaperAccount {
  const value = snapshot();
  return value === null
    ? emptyPaperAccount()
    : paperAccountSchema.parse(JSON.parse(value));
}
async function mutateAccount(change: (a: PaperAccount) => PaperAccount) {
  const work = () => {
    const next = change(readAccount());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("exitcheck-paper"));
  };
  if (navigator.locks) await navigator.locks.request(STORAGE_KEY, work);
  else work();
}
const depthSchema = z.object({
  notice: z.string(),
  estimate: z.object({
    requested: z.string(),
    fillable: z.string(),
    gross: z.string(),
    insufficient: z.boolean(),
    averagePrice: z.string().nullable(),
  }),
});
export function TradeTerminal() {
  const stored = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const ready = useSyncExternalStore(
    readySubscribe,
    () => true,
    () => false,
  );
  const account = useMemo(() => {
    try {
      return stored === null
        ? emptyPaperAccount()
        : paperAccountSchema.parse(JSON.parse(stored));
    } catch {
      return null;
    }
  }, [stored]);
  const [markets, setMarkets] = useState<MarketItem[]>([]),
    [warnings, setWarnings] = useState<string[]>([]),
    [feedError, setFeedError] = useState(""),
    [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(""),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("All");
  const [reports, setReports] = useState<Record<string, ResearchResult>>({}),
    [researching, setResearching] = useState(""),
    [researchError, setResearchError] = useState("");
  const [side, setSide] = useState<"YES" | "NO">("YES"),
    [limit, setLimit] = useState(""),
    [shares, setShares] = useState("10"),
    [approved, setApproved] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(0),
    [depth, setDepth] = useState<{ id: string; text: string } | null>(null),
    [depthBusy, setDepthBusy] = useState("");
  const researchController = useRef<AbortController | null>(null),
    orderPending = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let running = false;
    async function refresh() {
      if (running) return;
      running = true;
      try {
        const feed = marketFeedSchema.parse(
          await api("/api/trade", undefined, controller.signal),
        );
        if (!controller.signal.aborted) {
          setMarkets(feed.markets);
          setWarnings(feed.warnings);
          setFeedError("");
        }
      } catch {
        if (!controller.signal.aborted)
          setFeedError(
            "Market refresh failed. Existing quotes may be stale; retry shortly.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
        running = false;
      }
    }
    void refresh();
    const poll = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30000);
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      mounted.current = false;
      controller.abort();
      researchController.current?.abort();
      clearInterval(poll);
      clearInterval(timer);
    };
  }, []);
  const selected = markets.find((m) => m.id === selectedId) ?? markets[0];
  const report = selected ? reports[selected.id] : undefined;
  const shown = markets.filter(
    (m) =>
      (category === "All" || m.category === category) &&
      m.question.toLowerCase().includes(query.toLowerCase()),
  );
  function choose(m: MarketItem) {
    setSelectedId(m.id);
    setSide("YES");
    setLimit("");
    setApproved(false);
    setMessage("");
    setResearchError("");
  }
  function defaultLimit(m: MarketItem, chosenSide: "YES" | "NO") {
    const price = chosenSide === "YES" ? m.yesPrice : m.noPrice;
    return price === null
      ? ""
      : (Math.ceil(price * 1000000 * 1.0005) / 1000000).toFixed(6);
  }
  const effectiveLimit =
    limit || (selected ? defaultLimit(selected, side) : "");
  const quote = useMemo(() => {
    if (!selected)
      return { value: null, error: "Select a market to practice." };
    try {
      return {
        value: paperQuote(
          selected,
          side,
          shares,
          effectiveLimit,
          clock || selected.capturedAt,
        ),
        error: "",
      };
    } catch (e) {
      return {
        value: null,
        error: e instanceof Error ? e.message : "Invalid paper order.",
      };
    }
  }, [selected, side, shares, effectiveLimit, clock]);
  const [approvedKey, setApprovedKey] = useState("");
  const approvalKey = JSON.stringify([
    selected?.id,
    selected?.capturedAt,
    side,
    shares,
    effectiveLimit,
    account?.revision,
  ]);
  const humanApproved = approved && approvedKey === approvalKey;
  async function runResearch(m: MarketItem) {
    choose(m);
    researchController.current?.abort();
    const controller = new AbortController();
    researchController.current = controller;
    setResearching(m.id);
    setResearchError("");
    try {
      const result = researchSchema.parse(
        await api(
          "/api/trade/research",
          {
            marketId: m.id,
            question: m.question,
            marketPrice: m.yesPrice,
            rules: m.rules,
          },
          controller.signal,
        ),
      );
      if (!controller.signal.aborted && result.marketId === m.id)
        setReports((previous) => ({ ...previous, [m.id]: result }));
    } catch (e) {
      if (!controller.signal.aborted)
        setResearchError(
          e instanceof Error ? e.message : "Research unavailable.",
        );
    } finally {
      if (researchController.current === controller && mounted.current)
        setResearching("");
    }
  }
  async function execute() {
    if (!selected || orderPending.current || !ready || !account) return;
    orderPending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const id = crypto.randomUUID();
      await mutateAccount((current) => {
        if (current.revision !== account.revision)
          throw Error(
            "Paper balance or controls changed. Review and approve again.",
          );
        return executePaperOrder(
          current,
          selected,
          side,
          shares,
          effectiveLimit,
          humanApproved,
          id,
        );
      });
      setApproved(false);
      setMessage(
        "Paper order filled and saved on this browser. No real funds moved.",
      );
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Paper order could not be saved. Check browser storage.",
      );
    } finally {
      orderPending.current = false;
      setBusy(false);
    }
  }
  async function kill() {
    try {
      await mutateAccount((a) => ({
        ...a,
        killed: !a.killed,
        revision: a.revision + 1,
      }));
      setApproved(false);
    } catch {
      setMessage(
        "Unable to save the kill switch. Paper trading remains unavailable.",
      );
    }
  }
  async function preview(p: PaperPosition) {
    setDepthBusy(p.id);
    setDepth(null);
    try {
      const result = depthSchema.parse(
        await api("/api/trade/depth", {
          marketId: p.marketId,
          side: p.side,
          quantity: p.shares,
        }),
      );
      setDepth({
        id: p.id,
        text: `${decimal(result.estimate.fillable)} of ${decimal(result.estimate.requested)} shares fillable for ${money(result.estimate.gross)} gross. ${result.estimate.insufficient ? "Insufficient bids for a full exit. " : ""}${result.notice}`,
      });
    } catch (e) {
      setDepth({
        id: p.id,
        text: e instanceof Error ? e.message : "Exit depth unavailable.",
      });
    } finally {
      setDepthBusy("");
    }
  }
  const invested =
    account?.positions.reduce((sum, p) => sum + BigInt(p.cost), 0n) ?? 0n;
  return (
    <div className={styles.terminal}>
      <AppHeader badge="BETA" />
      <main className={styles.main}>
        <div className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>
              RESEARCH FIRST. PRACTICE WITH LIMITS.
            </p>
            <h1>
              ExitCheck Agent Terminal
              <span className={styles.live}>PAPER MODE</span>
            </h1>
            <p>
              Live prediction markets. Three research perspectives. Every order
              stays simulated.
            </p>
          </div>
          <div className={styles.controls}>
            <div className={styles.balance}>
              <small>AVAILABLE PAPER BALANCE</small>
              <strong>
                {account ? money(account.cash) : "Storage unavailable"}
              </strong>
              <span>
                {money(invested.toString())} invested · starts at $10,000
              </span>
            </div>
            <button
              className={account?.killed ? styles.killArmed : styles.kill}
              role="switch"
              aria-checked={account?.killed ?? true}
              disabled={!ready || !account}
              onClick={() => void kill()}
            >
              <span />
              Emergency kill switch
              <strong>
                {account?.killed
                  ? "ARMED · orders blocked"
                  : "OFF · paper orders only"}
              </strong>
            </button>
          </div>
        </div>
        <div className={styles.toolbar}>
          <label className={styles.search}>
            <span>⌕</span>
            <input
              aria-label="Search markets"
              placeholder="Search prediction markets…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className={styles.filters}>
            {["All", "Crypto", "Macro", "Tech"].map((c) => (
              <button
                key={c}
                aria-pressed={category === c}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <span className={styles.refresh}>
            30s refresh · {markets.length} contracts
          </span>
        </div>
        {(feedError || warnings.length > 0) && (
          <div className={styles.warning} role="status">
            {[feedError, ...warnings].filter(Boolean).join(" ")}
          </div>
        )}
        {!account && (
          <div className={styles.warning} role="alert">
            Paper storage is unavailable or invalid. Orders are blocked.{" "}
            <button
              onClick={() => {
                try {
                  if (
                    confirm("Reset this browser's paper ledger to $10,000?")
                  ) {
                    localStorage.setItem(
                      STORAGE_KEY,
                      JSON.stringify(emptyPaperAccount()),
                    );
                    window.dispatchEvent(new Event("exitcheck-paper"));
                  }
                } catch {
                  setMessage("Browser storage is unavailable.");
                }
              }}
            >
              Reset paper ledger
            </button>
          </div>
        )}
        <div className={styles.grid}>
          <section className={styles.feed} aria-label="Live market feed">
            <div className={styles.panelTitle}>
              <h2>Market feed</h2>
              <span>01 / DISCOVER</span>
            </div>
            {loading ? (
              <p className={styles.empty}>Loading live contracts…</p>
            ) : shown.length === 0 ? (
              <p className={styles.empty}>
                {markets.length
                  ? "No markets match your filters."
                  : "No live contracts available from these feeds. We’ll retry on the next refresh."}
              </p>
            ) : (
              shown.map((m) => (
                <article
                  key={m.id}
                  className={`${styles.card} ${selected?.id === m.id ? styles.selected : ""}`}
                >
                  <button
                    className={styles.marketSelect}
                    aria-pressed={selected?.id === m.id}
                    onClick={() => choose(m)}
                  >
                    <div className={styles.cardMeta}>
                      <span>
                        {m.source === "solana"
                          ? "SOLANA / FORECAST"
                          : m.dataProvider === "jupiter"
                            ? "POLYMARKET / VIA SOLANA"
                            : "POLYMARKET / POLYGON"}
                      </span>
                      <span>{m.category}</span>
                    </div>
                    <h3>{m.question}</h3>
                    <div className={styles.prices}>
                      <div>
                        <span>YES</span>
                        <strong>{percent(m.yesPrice)}</strong>
                        <div className={styles.gauge}>
                          <i style={{ width: `${(m.yesPrice ?? 0) * 100}%` }} />
                        </div>
                      </div>
                      <div>
                        <span>NO</span>
                        <strong>{percent(m.noPrice)}</strong>
                        <div className={`${styles.gauge} ${styles.noGauge}`}>
                          <i style={{ width: `${(m.noPrice ?? 0) * 100}%` }} />
                        </div>
                      </div>
                    </div>
                    <div className={styles.metrics}>
                      <span>
                        24h volume <b>{dollars(m.volume24h)}</b>
                      </span>
                      <span>
                        Liquidity <b>{dollars(m.liquidity)}</b>
                      </span>
                    </div>
                  </button>
                  <button
                    className={styles.researchButton}
                    disabled={Boolean(researching) || m.yesPrice === null}
                    onClick={() => void runResearch(m)}
                  >
                    {researching === m.id
                      ? "Researching bull / bear / synthesis…"
                      : "Run AI Research ↗"}
                  </button>
                </article>
              ))
            )}
          </section>
          <section
            className={styles.intelligence}
            aria-label="Intelligence and paper execution"
          >
            <div className={styles.panelTitle}>
              <h2>Intelligence & execution</h2>
              <span>02 / RESEARCH → 03 / PRACTICE</span>
            </div>
            {!selected ? (
              <p className={styles.empty}>
                Choose a contract to explore its rules and practice a trade.
              </p>
            ) : (
              <>
                <div className={styles.summary}>
                  <span className={styles.eyebrow}>
                    {selected.source.toUpperCase()} · LIVE SNAPSHOT
                  </span>
                  <h2>{selected.question}</h2>
                  <dl>
                    <div>
                      <dt>Resolution</dt>
                      <dd>{date(selected.resolutionDate)}</dd>
                    </div>
                    <div>
                      <dt>Resolution source</dt>
                      <dd>{selected.oracleSource}</dd>
                    </div>
                  </dl>
                  <details>
                    <summary>Read resolution rules</summary>
                    <p>
                      {selected.rules ||
                        "No rules supplied. Review the source before trading."}
                    </p>
                  </details>
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open original market / rules ↗
                  </a>
                </div>
                <div className={styles.researchPanel}>
                  <div className={styles.sectionHeading}>
                    <h3>Bayesian research</h3>
                    <button
                      disabled={
                        Boolean(researching) || selected.yesPrice === null
                      }
                      onClick={() => void runResearch(selected)}
                    >
                      {researching
                        ? "Working…"
                        : report
                          ? "Refresh research ↗"
                          : "Run AI Research ↗"}
                    </button>
                  </div>
                  {researchError && (
                    <p role="alert" className={styles.warning}>
                      {researchError}
                    </p>
                  )}
                  {!report ? (
                    <p className={styles.empty}>
                      Compare a bull case, a skeptical bear case and a
                      synthesis. Research estimates are hypotheses—not verified
                      probabilities.
                    </p>
                  ) : (
                    <>
                      <p className={styles.researchMode}>
                        {report.mode === "gemini"
                          ? "GEMINI 3.8 FLASH · THREE AGENTS"
                          : "MARKET-PRIOR BASELINE · NO AI EVIDENCE"}
                      </p>
                      <div className={styles.probabilities}>
                        <div>
                          <small>FAIR PROBABILITY</small>
                          <strong>{percent(report.fairProbability)}</strong>
                        </div>
                        <div>
                          <small>MARKET PRICE</small>
                          <strong>{percent(report.marketProbability)}</strong>
                        </div>
                        <div>
                          <small>ESTIMATED EDGE</small>
                          <strong
                            className={report.edge > 0 ? styles.positive : ""}
                          >
                            {report.edge >= 0 ? "+" : ""}
                            {(report.edge * 100).toFixed(1)} pp
                          </strong>
                        </div>
                      </div>
                      <div className={styles.agentStrip}>
                        {report.agents.map((a) => (
                          <span key={a.role}>
                            {a.role} <b>{percent(a.probability)}</b>
                          </span>
                        ))}
                        <span>
                          Confidence <b>{percent(report.confidence)}</b>
                        </span>
                      </div>
                      <p className={styles.notice}>
                        Edge excludes trading costs. {report.notice}
                      </p>
                      <div className={styles.theses}>
                        <div>
                          <h4>Bull case / YES</h4>
                          <ul>
                            {report.bullThesis.map((t, i) => (
                              <li key={i}>{t}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <h4>Bear case / NO</h4>
                          <ul>
                            {report.bearThesis.map((t, i) => (
                              <li key={i}>{t}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                      <h4 className={styles.evidenceTitle}>Evidence trail</h4>
                      {report.citations.length ? (
                        <div className={styles.tableWrap}>
                          <table>
                            <thead>
                              <tr>
                                <th>Source & evidence</th>
                                <th>Reliability*</th>
                              </tr>
                            </thead>
                            <tbody>
                              {report.citations.map((c) => (
                                <tr key={c.url}>
                                  <td>
                                    <a
                                      href={c.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      {c.title} ↗
                                    </a>
                                    <small>{c.source}</small>
                                    <p>{c.summary}</p>
                                  </td>
                                  <td>{percent(c.reliability)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p className={styles.notice}>
                            *Model assessment, not an independent verification
                            score.
                          </p>
                        </div>
                      ) : (
                        <p className={styles.notice}>
                          No independent citations collected. Baseline research
                          proposes PASS.
                        </p>
                      )}
                      {report.searchSuggestions.map((html, i) => (
                        <iframe
                          key={i}
                          title={`Google Search suggestions ${i + 1}`}
                          sandbox="allow-popups allow-popups-to-escape-sandbox"
                          srcDoc={html}
                          className={styles.suggestions}
                          referrerPolicy="no-referrer"
                        />
                      ))}
                      <div className={styles.falsification}>
                        <h4>Why this could be wrong</h4>
                        <p>{report.whyThisCouldBeWrong}</p>
                      </div>
                      <div className={styles.proposal}>
                        <span>Research proposal</span>
                        <strong>
                          {report.proposedTrade.action.replaceAll("_", " ")}
                        </strong>
                        <span>
                          {dollars(report.proposedTrade.kellyExposureUSD)}{" "}
                          capped quarter-Kelly exposure
                        </span>
                      </div>
                    </>
                  )}
                </div>
                <div className={styles.execution}>
                  <div className={styles.sectionHeading}>
                    <h3>Paper execution</h3>
                    <span className={styles.live}>SIMULATED ONLY</span>
                  </div>
                  <div className={styles.sides}>
                    {(["YES", "NO"] as const).map((s) => (
                      <button
                        key={s}
                        aria-pressed={side === s}
                        disabled={s === "NO" && selected.noPrice === null}
                        onClick={() => {
                          setSide(s);
                          setLimit("");
                          setApproved(false);
                        }}
                      >
                        BUY {s}
                      </button>
                    ))}
                  </div>
                  {selected.source === "solana" && (
                    <p className={styles.notice}>
                      Forecast’s market ID selects UP or DOWN. NO is unavailable
                      for this outcome token.
                    </p>
                  )}
                  <div className={styles.inputs}>
                    <label>
                      Limit price ($)
                      <input
                        inputMode="decimal"
                        value={effectiveLimit}
                        onChange={(e) => {
                          setLimit(e.target.value);
                          setApproved(false);
                        }}
                      />
                    </label>
                    <label>
                      Shares
                      <input
                        inputMode="decimal"
                        value={shares}
                        onChange={(e) => {
                          setShares(e.target.value);
                          setApproved(false);
                        }}
                      />
                    </label>
                  </div>
                  <dl className={styles.orderStats}>
                    <div>
                      <dt>Estimated paper cost</dt>
                      <dd>{quote.value ? money(quote.value.cost) : "—"}</dd>
                    </div>
                    <div>
                      <dt>Simulated slippage</dt>
                      <dd>0.05%</dd>
                    </div>
                    <div>
                      <dt>Payout if this outcome wins</dt>
                      <dd>{quote.value ? money(quote.value.payout) : "—"}</dd>
                    </div>
                  </dl>
                  <p className={styles.notice}>
                    Snapshot fill assumption, not an executable quote. Fees
                    excluded. $200 per market · $2,000 total exposure. Losing
                    outcomes pay $0.
                  </p>
                  {quote.error && (
                    <p className={styles.notice}>{quote.error}</p>
                  )}
                  <label className={styles.approval}>
                    <input
                      type="checkbox"
                      checked={humanApproved}
                      onChange={(e) => {
                        setApproved(e.target.checked);
                        setApprovedKey(approvalKey);
                      }}
                    />
                    Human Approval Gate — I confirm this simulated order.
                  </label>
                  <button
                    className={styles.execute}
                    disabled={
                      !ready ||
                      !account ||
                      account.killed ||
                      !humanApproved ||
                      !quote.value ||
                      busy
                    }
                    onClick={() => void execute()}
                  >
                    {account?.killed
                      ? "Kill switch armed — orders blocked"
                      : busy
                        ? "Saving paper order…"
                        : "Execute Paper Order →"}
                  </button>
                  {message && (
                    <p role="status" className={styles.message}>
                      {message}
                    </p>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
        <section className={styles.positions}>
          <div className={styles.panelTitle}>
            <h2>
              My Active Paper Positions{" "}
              <span>{account?.positions.length ?? 0}</span>
            </h2>
            <span>STORED ON THIS BROWSER</span>
          </div>
          {!account?.positions.length ? (
            <p className={styles.empty}>
              Your first paper order starts here. Research a market, set a limit
              and approve the simulation.
            </p>
          ) : (
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Contract</th>
                    <th>Side / shares</th>
                    <th>Entry</th>
                    <th>Market mark</th>
                    <th>Unrealized PnL</th>
                    <th>Exit depth</th>
                  </tr>
                </thead>
                <tbody>
                  {account.positions.map((p) => {
                    const m = markets.find((m) => m.id === p.marketId),
                      mark =
                        m && clock - m.capturedAt <= 60000
                          ? p.side === "YES"
                            ? m.yesPrice
                            : m.noPrice
                          : null;
                    const value =
                      mark === null
                        ? null
                        : (BigInt(Math.round(mark * 1000000)) *
                            BigInt(p.shares)) /
                          1000000n;
                    const pnl =
                      value === null
                        ? null
                        : Number(value - BigInt(p.cost)) / 1000000;
                    return (
                      <tr key={p.id}>
                        <td className={styles.positionQuestion}>
                          {p.question}
                          {depth?.id === p.id && (
                            <p role="status" className={styles.notice}>
                              {depth.text}
                            </p>
                          )}
                        </td>
                        <td>
                          {p.side} / {decimal(p.shares)}
                        </td>
                        <td>{money(p.entryPrice, 4)}</td>
                        <td>
                          {mark === null
                            ? "Unavailable"
                            : `$${mark.toFixed(4)}`}
                        </td>
                        <td
                          className={
                            pnl !== null && pnl >= 0 ? styles.positive : ""
                          }
                        >
                          {pnl === null
                            ? "Unavailable"
                            : `${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(2)}`}
                        </td>
                        <td>
                          <button
                            disabled={Boolean(depthBusy)}
                            onClick={() => void preview(p)}
                          >
                            {depthBusy === p.id
                              ? "Checking…"
                              : "Check Exit Liquidity"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <footer className={styles.footer}>
          ExitCheck Agentic Trade & Prediction Terminal · Paper practice is not
          evidence of achievable live returns.
        </footer>
      </main>
    </div>
  );
}
