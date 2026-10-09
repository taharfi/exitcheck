import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { z } from "zod";
import type { MarketItem } from "./types";
import styles from "./terminal.module.css";
const KEY = "exitcheck.trade.alerts.v1";
const watchSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  question: z.string().max(1000),
  kind: z.enum(["above", "below", "depth", "resolution"]),
  side: z.enum(["YES", "NO"]),
  threshold: z.number().min(0).max(1),
  quantity: z.string().regex(/^\d{1,16}$/),
  firedAt: z.number().nullable(),
  message: z.string().max(1000),
});
const listSchema = z.array(watchSchema).max(5);
type Watch = z.infer<typeof watchSchema>;
function subscribe(fn: () => void) {
  window.addEventListener("storage", fn);
  window.addEventListener("exitcheck-alerts", fn);
  return () => {
    window.removeEventListener("storage", fn);
    window.removeEventListener("exitcheck-alerts", fn);
  };
}
function snapshot() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return "unavailable";
  }
}
function read(): Watch[] {
  const raw = snapshot();
  return raw === null ? [] : listSchema.parse(JSON.parse(raw));
}
async function change(fn: (list: Watch[]) => Watch[]) {
  const work = () => {
    localStorage.setItem(KEY, JSON.stringify(listSchema.parse(fn(read()))));
    window.dispatchEvent(new Event("exitcheck-alerts"));
  };
  if (navigator.locks) await navigator.locks.request(KEY, work);
  else work();
}
export function Watchlist({
  markets,
  selected,
  side,
  quantity,
}: {
  markets: MarketItem[];
  selected?: MarketItem;
  side: "YES" | "NO";
  quantity: string | null;
}) {
  const stored = useSyncExternalStore(subscribe, snapshot, () => null);
  const watches = useMemo(() => {
    try {
      return stored === null ? [] : listSchema.parse(JSON.parse(stored));
    } catch {
      return null;
    }
  }, [stored]);
  const [kind, setKind] = useState<Watch["kind"]>("above"),
    [threshold, setThreshold] = useState("0.65"),
    [message, setMessage] = useState("");
  const lastCheck = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    async function check() {
      if (
        busy ||
        document.hidden ||
        !watches ||
        !watches.some((w) => w.firedAt === null) ||
        Date.now() - lastCheck.current < 60000
      )
        return;
      busy = true;
      lastCheck.current = Date.now();
      for (const w of watches.filter((w) => w.firedAt === null)) {
        if (controller.signal.aborted) break;
        try {
          const m = markets.find((m) => m.id === w.marketId);
          let result = "";
          if (w.kind === "above" || w.kind === "below") {
            const price = m && (w.side === "YES" ? m.yesPrice : m.noPrice);
            if (
              m &&
              m.tradable &&
              Date.parse(m.resolutionDate) > Date.now() &&
              Date.now() - m.capturedAt <= 60000 &&
              m.capturedAt <= Date.now() + 1000 &&
              price !== null &&
              price !== undefined &&
              (w.kind === "above" ? price >= w.threshold : price <= w.threshold)
            )
              result = `${w.side} reached ${(price * 100).toFixed(1)}% at a fresh provider snapshot.`;
          } else {
            const response = await fetch(
              `/api/trade/${w.kind === "depth" ? "depth" : "settlement"}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: controller.signal,
                body: JSON.stringify(
                  w.kind === "depth"
                    ? {
                        marketId: w.marketId,
                        side: w.side,
                        quantity: w.quantity,
                      }
                    : { marketId: w.marketId },
                ),
              },
            );
            if (!response.ok) {
              setMessage(
                "Some watch checks are unavailable. No outcome or exit is assumed.",
              );
              continue;
            }
            const raw: unknown = await response.json();
            if (w.kind === "depth") {
              const r = z
                .object({
                  marketId: z.literal(w.marketId),
                  side: z.literal(w.side),
                  estimate: z.object({
                    requested: z.literal(w.quantity),
                    insufficient: z.boolean(),
                    capturedAt: z.number(),
                  }),
                })
                .parse(raw);
              if (
                Date.now() - r.estimate.capturedAt <= 20000 &&
                r.estimate.capturedAt <= Date.now() + 1000 &&
                r.estimate.insufficient
              )
                result =
                  "Fresh bids do not cover your watched quantity. Review exit liquidity.";
            } else {
              const r = z
                .object({
                  marketId: z.literal(w.marketId),
                  state: z.string(),
                  result: z.enum(["yes", "no"]).nullable(),
                  capturedAt: z.number(),
                })
                .parse(raw);
              if (
                r.state === "resolved" &&
                r.result &&
                Date.now() - r.capturedAt <= 60000 &&
                r.capturedAt <= Date.now() + 1000
              )
                result = `Provider confirmed ${r.result.toUpperCase()}. Review your paper settlement.`;
            }
          }
          if (result && !controller.signal.aborted)
            await change((current) =>
              current.map((x) =>
                x.id === w.id && x.firedAt === null
                  ? { ...x, firedAt: Date.now(), message: result }
                  : x,
              ),
            );
        } catch {
          if (!controller.signal.aborted)
            setMessage(
              "A watch check failed. Alerts will retry while this page is open.",
            );
        }
      }
      busy = false;
    }
    void check();
    const timer = setInterval(() => void check(), 60000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [markets, watches]);
  async function add() {
    if (!selected || !quantity || !watches) return;
    try {
      const value = z.coerce.number().min(0.01).max(0.99).parse(threshold);
      await change((current) => [
        ...current,
        watchSchema.parse({
          id: crypto.randomUUID(),
          marketId: selected.id,
          question: selected.question,
          kind,
          side,
          threshold: value,
          quantity,
          firedAt: null,
          message: "",
        }),
      ]);
      setMessage("Watch saved. It runs while this page is open and visible.");
    } catch {
      setMessage(
        "Enter a price between 0.01 and 0.99. At most five watches can be saved.",
      );
    }
  }
  return (
    <section className={styles.tradeCheck} aria-label="Market watchlist">
      <h2>Watch what changes</h2>
      <p className={styles.notice}>
        Up to five once-only in-app alerts, stored on this browser. Checks run
        about once a minute while this page is open and visible. No server
        background monitoring or automatic orders.
      </p>
      <div className={styles.inputs}>
        <label>
          Alert condition
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as Watch["kind"])}
          >
            <option value="above">Price rises to</option>
            <option value="below">Price falls to</option>
            <option value="depth">Insufficient exit depth</option>
            <option value="resolution">Verified resolution</option>
          </select>
        </label>
        {(kind === "above" || kind === "below") && (
          <label>
            Outcome price ($)
            <input
              inputMode="decimal"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </label>
        )}
      </div>
      <p className={styles.notice}>
        Selected: {selected?.question ?? "Choose a market"} · {side}
      </p>
      <button
        className={styles.checkExit}
        disabled={!selected || !quantity || !watches || watches.length >= 5}
        onClick={() => void add()}
      >
        Watch selected market
      </button>
      {message && <p role="status">{message}</p>}
      {!watches && (
        <p>Watch storage is unavailable. Existing data has not been reset.</p>
      )}
      {watches?.map((w) => (
        <div key={w.id} className={styles.checkDecision}>
          <strong>{w.question}</strong>
          <p>
            {w.kind === "above" || w.kind === "below"
              ? `${w.side} ${w.kind} ${(w.threshold * 100).toFixed(1)}%`
              : w.kind === "depth"
                ? "Exit depth for the saved quantity"
                : "Provider-confirmed resolution"}{" "}
            · {w.firedAt ? "Triggered" : "Watching"}
          </p>
          {w.message && <p role="status">{w.message}</p>}
          <button
            onClick={() =>
              void change((current) =>
                current.filter((x) => x.id !== w.id),
              ).catch(() => setMessage("Could not remove this watch."))
            }
          >
            Remove watch
          </button>
        </div>
      ))}
    </section>
  );
}
