"use client";
import { useState } from "react";
import type { MarketItem } from "./types";
import {
  pantaDataSchema,
  addressSchema,
  type PantaData,
} from "./panta-data-types";
import s from "./panta-insights.module.css";

const price = (n: number | null) =>
  n === null ? "Unavailable" : `${(n * 100).toFixed(1)}%`;
const volume = (n: number | null) =>
  n === null
    ? "Unavailable"
    : `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`;
const short = (text: string) => `${text.slice(0, 6)}…${text.slice(-4)}`;

export function PantaInsights({ market }: { market: MarketItem }) {
  const [activity, setActivity] = useState<PantaData | null>(null);
  const [holdings, setHoldings] = useState<PantaData | null>(null);
  const [wallet, setWallet] = useState("");
  const [loading, setLoading] = useState<"market" | "wallet" | null>(null);
  const [error, setError] = useState("");
  async function load(kind: "market" | "wallet") {
    if (kind === "wallet" && !addressSchema.safeParse(wallet.trim()).success) {
      setError("Enter a valid public Solana wallet address.");
      return;
    }
    setLoading(kind);
    setError("");
    if (kind === "wallet") setHoldings(null);
    else setActivity(null);
    try {
      const query = new URLSearchParams(
        kind === "market"
          ? { marketId: market.providerId }
          : { wallet: wallet.trim() },
      );
      const response = await fetch(`/api/panta/insights?${query}`, {
        signal: AbortSignal.timeout(12000),
        cache: "no-store",
      });
      if (!response.ok)
        throw Error("Panta data could not be loaded. Retry shortly.");
      const data = pantaDataSchema.parse(await response.json());
      if (kind === "market") setActivity(data);
      else setHoldings(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Panta data is unavailable.");
    } finally {
      setLoading(null);
    }
  }
  const details = market.pantaDetails;
  function tape(data: PantaData) {
    return (
      <div className={s.results}>
        <p>
          Retrieved {new Date(data.capturedAt).toLocaleString()} · Recent
          catalog history, capped at 50 rows. Not a complete ledger.
        </p>
        {data.warnings.map((warning) => (
          <p role="status" key={warning}>
            {warning}
          </p>
        ))}
        {!data.warnings.some((w) => w.startsWith("Trade history")) &&
          !data.trades.length && <p>No catalog trades returned.</p>}
        {data.trades.length > 0 && (
          <div className={s.scroll}>
            <table>
              <caption>Recent Panta trades</caption>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Market / wallet</th>
                  <th>YES / NO amounts</th>
                  <th>Reported fee</th>
                  <th>Transaction</th>
                </tr>
              </thead>
              <tbody>
                {data.trades.map((t) => (
                  <tr key={`${t.id}-${t.signature}`}>
                    <td>
                      {t.blockTime === null
                        ? "Unknown"
                        : new Date(t.blockTime * 1000).toLocaleString()}
                    </td>
                    <td>
                      {short(data.wallet ? t.marketId : t.wallet)}
                      <small>{t.isPrimary ? "Primary" : "Secondary"}</small>
                    </td>
                    <td>
                      {t.yesAmount} / {t.noAmount}
                    </td>
                    <td>
                      {t.feePaid ?? "Unknown"}
                      <small>Quote asset: {t.quoteAsset}</small>
                    </td>
                    <td>
                      <a
                        href={`https://solscan.io/tx/${t.signature}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View ↗
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }
  return (
    <details className={s.panel}>
      <summary>Panta data & wallet holdings</summary>
      <div className={s.body}>
        <a
          href="https://panta.market"
          target="_blank"
          rel="noopener noreferrer"
          className={s.attribution}
        >
          Powered by Panta ↗
        </a>
        {details && (
          <dl className={s.facts}>
            <div>
              <dt>Phase / market type</dt>
              <dd>
                {details.phase} / {details.marketType ?? "Unavailable"}
              </dd>
            </div>
            <div>
              <dt>Provider category / region</dt>
              <dd>
                {details.category} / {details.region ?? "Unavailable"}
              </dd>
            </div>
            <div>
              <dt>Total reported volume</dt>
              <dd>{volume(details.totalVolumeUsdc)}</dd>
            </div>
            <div>
              <dt>Primary YES / NO</dt>
              <dd>
                {price(details.primaryYesPrice)} /{" "}
                {price(details.primaryNoPrice)}
              </dd>
            </div>
            <div>
              <dt>Secondary YES / NO</dt>
              <dd>
                {price(details.secondaryYesPrice)} /{" "}
                {price(details.secondaryNoPrice)}
              </dd>
            </div>
            <div>
              <dt>Graduated</dt>
              <dd>
                {details.isGraduated === null
                  ? "Unavailable"
                  : details.isGraduated
                    ? "Yes"
                    : "No"}
              </dd>
            </div>
          </dl>
        )}
        <p className={s.note}>
          Total volume is not 24-hour volume or exit liquidity. Prices are
          provider snapshots, not executable quotes.
        </p>
        <button
          type="button"
          disabled={loading !== null}
          onClick={() => void load("market")}
        >
          {loading === "market"
            ? "Loading activity…"
            : "Load recent market trades"}
        </button>
        {activity && (
          <>
            {tape(activity)}
            {activity.categories.length > 0 && (
              <p className={s.note}>
                Provider categories: {activity.categories.join(", ")}
              </p>
            )}
          </>
        )}
        <form
          className={s.wallet}
          onSubmit={(event) => {
            event.preventDefault();
            void load("wallet");
          }}
        >
          <label htmlFor="panta-public-wallet">Inspect a public wallet</label>
          <p className={s.note}>
            Read-only Panta holdings and catalog history. This address is sent
            to Panta for lookup; no signature is required.
          </p>
          <input
            id="panta-public-wallet"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="Solana public address"
            autoComplete="off"
            spellCheck={false}
            maxLength={44}
          />
          <button disabled={loading !== null} type="submit">
            {loading === "wallet" ? "Loading holdings…" : "Look up wallet"}
          </button>
        </form>
        {error && (
          <p role="alert" className={s.note}>
            {error}
          </p>
        )}
        {holdings && (
          <div className={s.results}>
            <p>
              Wallet: {short(holdings.wallet ?? "")} · Holdings capped by the
              provider at 200 rows; indexing may lag.
            </p>
            {!holdings.warnings.some((w) => w.startsWith("Wallet positions")) &&
              holdings.positions.length === 0 && (
                <p>No Panta holdings returned for this wallet.</p>
              )}
            {holdings.positions.length > 0 && (
              <div className={s.scroll}>
                <table>
                  <caption>Panta wallet holdings</caption>
                  <thead>
                    <tr>
                      <th>Market</th>
                      <th>Side / shares</th>
                      <th>Phase</th>
                      <th>Claim status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holdings.positions.map((p) => (
                      <tr key={`${p.marketId}-${p.side}`}>
                        <td>
                          <a
                            href={`https://solscan.io/account/${p.marketId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {short(p.marketId)} ↗
                          </a>
                        </td>
                        <td>
                          {p.side.toUpperCase()} / {p.shares}
                        </td>
                        <td>
                          {p.phase}
                          <small>Outcome: {p.outcome ?? "Unresolved"}</small>
                        </td>
                        <td>
                          {p.claimed
                            ? "Already claimed"
                            : p.claimable
                              ? "Provider reports claimable"
                              : "Not claimable"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className={s.note}>
              Shares are not a dollar balance. Claim eligibility is
              provider-reported; ExitCheck does not build or submit claims here.
            </p>
            {tape(holdings)}
          </div>
        )}
      </div>
    </details>
  );
}
