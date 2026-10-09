import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { decimal, money } from "@/lib/amounts";
import {
  closePaperPosition,
  paperAccountSchema,
  realizePaperPosition,
  type PaperAccount,
} from "./paper";
import styles from "./terminal.module.css";

const units = z.string().regex(/^\d{1,16}$/);
const depthResponse = z.object({
  marketId: z.string(),
  side: z.enum(["YES", "NO"]),
  estimate: z.object({
    requested: units,
    fillable: units,
    gross: units,
    capturedAt: z.number().int(),
    insufficient: z.boolean(),
    averagePrice: units.nullable(),
    fee: units.nullable().default(null),
    net: units.nullable().default(null),
    remaining: units.default("0"),
    referenceValue: units.nullable().default(null),
    impactBps: units.nullable().default(null),
    impactReferencePrice: units.nullable().default(null),
  }),
});
const settlementSchema = z.object({
  marketId: z.string(),
  state: z.enum(["resolved", "pending", "unsupported"]),
  result: z.enum(["yes", "no"]).nullable(),
  source: z.string().max(300),
  capturedAt: z.number().int(),
});
const signedMoney = (n: bigint) =>
  `${n < 0n ? "−" : "+"}${money((n < 0n ? -n : n).toString())}`;
export function PaperJournal({
  account,
  mutate,
  now,
}: {
  account: PaperAccount;
  mutate: (change: (a: PaperAccount) => PaperAccount) => Promise<void>;
  now: number;
}) {
  const [selected, setSelected] = useState("");
  const [preview, setPreview] = useState<z.infer<typeof depthResponse> | null>(
    null,
  );
  const [settlement, setSettlement] = useState<z.infer<
    typeof settlementSchema
  > | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const p =
    account.positions.find((p) => p.id === selected) ?? account.positions[0];
  const fresh =
    preview &&
    p &&
    preview.marketId === p.marketId &&
    preview.side === p.side &&
    preview.estimate.requested === p.shares &&
    now - preview.estimate.capturedAt <= 20000 &&
    preview.estimate.capturedAt <= now + 1000;
  const resolved =
    settlement &&
    p &&
    settlement.marketId === p.marketId &&
    settlement.state === "resolved" &&
    settlement.result !== null &&
    now - settlement.capturedAt <= 60000 &&
    settlement.capturedAt <= now + 1000;
  async function check(kind: "depth" | "settlement") {
    if (!p || busy) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setApproved(false);
    setPreview(null);
    setSettlement(null);
    setMessage("");
    try {
      const response = await fetch(`/api/trade/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: request.signal,
        body: JSON.stringify(
          kind === "depth"
            ? { marketId: p.marketId, side: p.side, quantity: p.shares }
            : { marketId: p.marketId },
        ),
      });
      const value: unknown = await response.json();
      if (!response.ok) {
        const failure = z
          .object({ error: z.object({ message: z.string() }) })
          .safeParse(value);
        throw Error(
          failure.success
            ? failure.data.error.message
            : "Provider check unavailable. No paper balance changed.",
        );
      }
      if (request.signal.aborted) return;
      if (kind === "depth") {
        const result = depthResponse.parse(value);
        if (
          result.marketId !== p.marketId ||
          result.side !== p.side ||
          result.estimate.requested !== p.shares
        )
          throw Error("Exit preview does not match this holding.");
        setPreview(result);
      } else {
        const result = settlementSchema.parse(value);
        if (result.marketId !== p.marketId)
          throw Error("Settlement does not match this holding.");
        setSettlement(result);
        if (result.state !== "resolved")
          setMessage(
            "No verified final result. Position remains open and unsettled.",
          );
      }
    } catch (e) {
      if (!request.signal.aborted)
        setMessage(e instanceof Error ? e.message : "Check unavailable.");
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }
  async function apply() {
    if (!p || busy || !approved) return;
    setBusy(true);
    try {
      await mutate((current) => {
        if (current.revision !== account.revision)
          throw Error("Paper account changed. Review the action again.");
        if (fresh && preview)
          return closePaperPosition(
            current,
            p.id,
            preview.estimate,
            approved,
            crypto.randomUUID(),
          );
        if (resolved && settlement) {
          if (Date.now() - settlement.capturedAt > 60000)
            throw Error("Settlement preview expired.");
          return realizePaperPosition(
            current,
            p.id,
            {
              id: crypto.randomUUID(),
              shares: p.shares,
              proceeds:
                p.side.toLowerCase() === settlement.result ? p.shares : "0",
              kind: "settle",
              source: settlement.source,
            },
            approved,
          );
        }
        throw Error("Refresh a matching provider preview first.");
      });
      setPreview(null);
      setSettlement(null);
      setApproved(false);
      setMessage("Paper action recorded. No real funds moved.");
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Paper action could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  function exportJournal() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(account, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "exitcheck-paper-journal.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  async function cloud(save: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(
        "/api/trade/journal",
        save
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ account }),
            }
          : {},
      );
      const raw: unknown = await response.json();
      if (!response.ok) {
        const failure = z
          .object({ error: z.object({ message: z.string() }) })
          .safeParse(raw);
        throw Error(
          failure.success
            ? failure.data.error.message
            : "Private journal unavailable.",
        );
      }
      if (save)
        setMessage("Private journal saved to your signed-in wallet account.");
      else {
        const result = z
          .object({
            signedIn: z.boolean(),
            account: paperAccountSchema.nullable(),
          })
          .parse(raw);
        if (!result.signedIn)
          throw Error("Sign in with your wallet to load your private journal.");
        if (!result.account) throw Error("No saved journal for this account.");
        if (
          !confirm(
            "Replace this browser's paper journal with your saved private journal? Export your current journal first if needed.",
          )
        )
          return;
        await mutate((current) => {
          if (current.revision !== account.revision)
            throw Error("Browser journal changed. Load again.");
          return {
            ...result.account!,
            revision: current.revision + 1,
            killed: current.killed || result.account!.killed,
          };
        });
      }
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Could not save or load the journal.",
      );
    } finally {
      setBusy(false);
    }
  }
  const realized = account.journal.reduce(
    (sum, e) => sum + BigInt(e.proceeds) - BigInt(e.costBasis),
    0n,
  );
  return (
    <section className={styles.tradeCheck} aria-label="Paper journal">
      <div className={styles.sectionHeading}>
        <h2>Paper journal</h2>
        <button
          type="button"
          className={styles.checkExit}
          onClick={exportJournal}
        >
          Export journal
        </button>
      </div>
      <p>
        Realized paper result: <strong>{signedMoney(realized)}</strong> ·{" "}
        {account.journal.length} recorded exits or settlements
      </p>
      <p className={styles.notice}>
        Saved on this browser. Actual fees are unknown. Results include each
        entry&apos;s chosen paper fee assumption, or exclude fees when none was
        chosen. Legacy entries without a receipt remain available.
      </p>
      <div className={styles.journalActions}>
        <button disabled={busy} onClick={() => void cloud(true)}>
          Save private backup
        </button>
        <button disabled={busy} onClick={() => void cloud(false)}>
          Load private backup
        </button>
      </div>
      {p && (
        <div>
          <label>
            Manage a paper holding{" "}
            <select
              value={p.id}
              disabled={busy}
              onChange={(e) => {
                setSelected(e.target.value);
                setPreview(null);
                setSettlement(null);
                setApproved(false);
                setMessage("");
              }}
            >
              {account.positions.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.question} · {x.side}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.journalActions}>
            <button disabled={busy} onClick={() => void check("depth")}>
              Preview paper close
            </button>
            <button disabled={busy} onClick={() => void check("settlement")}>
              Check verified settlement
            </button>
          </div>
          {preview && (
            <p>
              {fresh
                ? `${decimal(preview.estimate.fillable)} of ${decimal(preview.estimate.requested)} shares can be paper-closed for ${money(preview.estimate.gross)} gross at this snapshot.`
                : "Exit preview expired. Refresh before closing."}{" "}
              {preview.estimate.insufficient && "Unfilled shares stay open."}{" "}
              Paper exit fee assumption:{" "}
              {((p.receipt?.feeBps ?? 0) / 100).toFixed(2)}% of gross proceeds.
              Actual venue fees remain unknown.
            </p>
          )}
          {resolved && settlement && (
            <p>
              Provider confirmed {settlement.result?.toUpperCase()}. Paper
              payout:{" "}
              {money(
                p.side.toLowerCase() === settlement.result ? p.shares : "0",
              )}
              .
            </p>
          )}
          {(fresh || resolved) && (
            <>
              <label className={styles.approval}>
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(e) => setApproved(e.target.checked)}
                />
                I approve this paper close or settlement.
              </label>
              <button
                className={styles.execute}
                disabled={
                  !approved ||
                  busy ||
                  account.killed ||
                  Boolean(fresh && preview?.estimate.fillable === "0")
                }
                onClick={() => void apply()}
              >
                Record paper action
              </button>
            </>
          )}
          <details className={styles.checkRules}>
            <summary>Original decision receipt</summary>
            {p.receipt ? (
              <>
                <p>{p.receipt.thesis}</p>
                <p>
                  Source: {p.receipt.market.dataProvider} · quote captured{" "}
                  {new Date(p.receipt.market.capturedAt).toISOString()} ·
                  analysis {p.receipt.model}
                </p>
                <p>{p.receipt.market.rules}</p>
                {p.receipt.citations.map((url) => (
                  <p key={url}>
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      Evidence source
                    </a>
                  </p>
                ))}
              </>
            ) : (
              <p>This legacy position has no saved research receipt.</p>
            )}
          </details>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>Contract / action</th>
              <th>Shares</th>
              <th>Cost basis</th>
              <th>Proceeds</th>
              <th>Realized paper result</th>
            </tr>
          </thead>
          <tbody>
            {account.journal
              .slice()
              .reverse()
              .map((e) => (
                <tr key={e.id}>
                  <td>
                    {e.question} · {e.side} · {e.kind}
                    <small>
                      {new Date(e.at).toISOString()} · {e.source}
                    </small>
                  </td>
                  <td>{decimal(e.shares)}</td>
                  <td>{money(e.costBasis)}</td>
                  <td>{money(e.proceeds)}</td>
                  <td>
                    {signedMoney(BigInt(e.proceeds) - BigInt(e.costBasis))}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
