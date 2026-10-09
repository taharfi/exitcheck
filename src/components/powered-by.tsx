"use client";
import Image from "next/image";
import { useState } from "react";
import styles from "./powered-by.module.css";

const services = [
  { name: "Solana", href: "https://solana.com", role: "Blockchain" },
  { name: "Jupiter", href: "https://jup.ag", role: "Solana prediction data" },
  {
    name: "Polymarket",
    href: "https://polymarket.com",
    role: "Markets and order books",
  },
  { name: "DeepSeek", href: "https://www.deepseek.com", role: "AI research" },
  {
    name: "Turso",
    href: "https://turso.tech",
    role: "Private account storage",
  },
  { name: "Vercel", href: "https://vercel.com", role: "Hosting" },
  {
    name: "Next.js",
    href: "https://nextjs.org",
    role: "Application framework",
  },
  { name: "React", href: "https://react.dev", role: "Interface" },
  { name: "Phantom", href: "https://phantom.com", role: "Supported wallet" },
  { name: "Solflare", href: "https://solflare.com", role: "Supported wallet" },
] as const;

export function PoweredBy({ panta = false }: { panta?: boolean }) {
  const [paused, setPaused] = useState(false);
  const logos: Record<string, string> = {
    Solana: "solana.png",
    Jupiter: "jupiter.svg",
    Polymarket: "polymarket.png",
    DeepSeek: "deepseek.svg",
    Turso: "turso.svg",
    Vercel: "vercel.ico",
    "Next.js": "nextjs.ico",
    React: "react.svg",
    Phantom: "phantom.svg",
    Solflare: "solflare.svg",
    Panta: "panta.svg",
  };
  const credits = panta
    ? [
        {
          name: "Panta",
          href: "https://panta.market",
          role: "Solana market research",
        },
        ...services,
      ]
    : services;
  return (
    <section className={styles.credits} aria-label="Technology credits">
      <div className={styles.heading}>
        <div className={styles.title}>
          <span className={styles.label}>Powered by</span>
          {panta && (
            <a
              className={styles.panta}
              href="https://panta.market"
              target="_blank"
              rel="noopener noreferrer"
            >
              Powered by Panta <span aria-hidden="true">↗</span>
            </a>
          )}
        </div>
        <button
          className={styles.control}
          type="button"
          aria-label={paused ? "Resume logo scrolling" : "Pause logo scrolling"}
          onClick={() => setPaused((value) => !value)}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="currentColor"
            aria-hidden="true"
          >
            {paused ? (
              <path d="M3 1.5 10 6l-7 4.5z" />
            ) : (
              <>
                <rect x="2" y="1.5" width="3" height="9" rx=".5" />
                <rect x="7" y="1.5" width="3" height="9" rx=".5" />
              </>
            )}
          </svg>
          {paused ? "Play" : "Pause"}
        </button>
      </div>
      <div className={styles.viewport}>
        <div className={`${styles.track} ${paused ? styles.paused : ""}`}>
          {[false, true].map((duplicate) => (
            <div
              className={`${styles.group} ${duplicate ? styles.duplicate : ""}`}
              key={String(duplicate)}
              aria-hidden={duplicate || undefined}
            >
              {credits.map((service) => (
                <a
                  className={styles.logoCard}
                  key={service.name}
                  href={service.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={service.role}
                  tabIndex={duplicate ? -1 : undefined}
                >
                  <Image
                    src={`/logos/${logos[service.name]}`}
                    width={26}
                    height={26}
                    alt=""
                    unoptimized
                    loading="eager"
                    className={`${styles.logo} ${["Solana", "Jupiter"].includes(service.name) ? styles.darkLogo : ""}`}
                  />
                  <span>{service.name}</span>
                </a>
              ))}
            </div>
          ))}
        </div>
      </div>
      <small>
        Primary-source context:{" "}
        <a
          href="https://www.coinbase.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          Coinbase
        </a>
        {" · "}
        <a
          href="https://www.federalreserve.gov"
          target="_blank"
          rel="noopener noreferrer"
        >
          Federal Reserve
        </a>
        {" · "}
        <a
          href="https://openai.com/news/"
          target="_blank"
          rel="noopener noreferrer"
        >
          OpenAI
        </a>
        {". Available research alternative: "}
        <a
          href="https://ai.google.dev/gemini-api/docs"
          target="_blank"
          rel="noopener noreferrer"
        >
          Google Gemini
        </a>
        .
      </small>
    </section>
  );
}
