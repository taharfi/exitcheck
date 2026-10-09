import { z } from "zod";
import { readLimitedText } from "@/lib/read-limited-text";
import { AppError } from "@/lib/errors";
import type { MarketItem } from "./types";
export type EvidenceItem = {
  title: string;
  source: string;
  url: string;
  summary: string;
  reliability: number;
  capturedAt: number;
};
const text = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;|&gt;|&quot;|&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export async function collectEvidence(
  m: MarketItem,
  transport: typeof fetch = fetch,
): Promise<EvidenceItem[]> {
  const asset = /\bbitcoin\b|\bbtc\b/i.test(m.question)
    ? "BTC"
    : /ethereum|\beth\b/i.test(m.question)
      ? "ETH"
      : /solana|\bsol\b/i.test(m.question)
        ? "SOL"
        : null;
  if (asset && m.category === "Crypto") {
    const url = `https://api.coinbase.com/v2/prices/${asset}-USD/spot`;
    try {
      const r = await transport(url, {
        signal: AbortSignal.timeout(7000),
        cache: "no-store",
        redirect: "error",
      });
      if (!r.ok) return [];
      const data = z
        .object({
          data: z.object({
            amount: z.string().regex(/^\d+(\.\d+)?$/),
            currency: z.literal("USD"),
            base: z.literal(asset).optional(),
          }),
        })
        .parse(
          JSON.parse(
            await readLimitedText(
              r,
              20000,
              () =>
                new AppError(
                  "EVIDENCE_TOO_LARGE",
                  "Evidence response too large.",
                  502,
                ),
            ),
          ),
        );
      return [
        {
          title: `${asset} spot price observation`,
          source: "Coinbase public price API",
          url,
          summary: `Coinbase reports ${asset}/USD at $${data.data.amount}. Current context only: this venue may differ from the contract's resolution oracle and does not establish the future outcome.`,
          reliability: 0,
          capturedAt: Date.now(),
        },
      ];
    } catch {
      return [];
    }
  }
  const feed = /federal reserve|\bfed\b|interest rate|fomc/i.test(m.question)
    ? {
        url: "https://www.federalreserve.gov/feeds/press_monetary.xml",
        host: "www.federalreserve.gov",
        source: "Federal Reserve monetary policy releases",
      }
    : /openai|chatgpt/i.test(m.question)
      ? {
          url: "https://openai.com/news/rss.xml",
          host: "openai.com",
          source: "OpenAI official news",
        }
      : null;
  if (!feed) return [];
  try {
    const response = await transport(feed.url, {
      signal: AbortSignal.timeout(7000),
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) return [];
    const xml = await readLimitedText(
      response,
      1000000,
      () =>
        new AppError("EVIDENCE_TOO_LARGE", "Evidence response too large.", 502),
    );
    const items: EvidenceItem[] = [];
    for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
      const value = (name: string) =>
        text(
          match[1].match(
            new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`),
          )?.[1] ?? "",
        );
      const published = Date.parse(value("pubDate"));
      const title = value("title"),
        link = value("link");
      if (
        !Number.isFinite(published) ||
        published > Date.now() + 60000 ||
        Date.now() - published > 90 * 86400000
      )
        continue;
      let url: URL;
      try {
        url = new URL(link);
      } catch {
        continue;
      }
      if (
        url.protocol !== "https:" ||
        url.hostname !== feed.host ||
        url.username ||
        url.password
      )
        continue;
      if (
        feed.host === "openai.com" &&
        !/openai|chatgpt|gpt|model/i.test(title)
      )
        continue;
      items.push({
        title: title.slice(0, 300),
        source: feed.source,
        url: url.href,
        summary: `Official release published ${new Date(published).toISOString()}: ${value("description").slice(0, 500)}. Verify relevance to this contract; retrieval is not proof of its outcome.`,
        reliability: 0,
        capturedAt: Date.now(),
      });
      if (items.length === 3) break;
    }
    return items;
  } catch {
    return [];
  }
}
