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
  return (
    <section className={styles.credits} aria-label="Technology credits">
      <span className={styles.label}>Powered by</span>
      <div className={styles.links}>
        {panta && (
          <a
            href="https://panta.market"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.panta}
          >
            Powered by Panta
          </a>
        )}
        {services.map((service) => (
          <a
            key={service.name}
            href={service.href}
            target="_blank"
            rel="noopener noreferrer"
            title={service.role}
          >
            {service.name}
          </a>
        ))}
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
