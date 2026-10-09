import Link from "next/link";
import { PoweredBy } from "@/components/powered-by";
import { BrandMark } from "@/components/brand";
import { LiveMarketPreview } from "./live-market-preview";
import styles from "./landing.module.css";

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <span aria-hidden="true">{diagonal ? "↗" : "→"}</span>;
}

const questions = [
  [
    "Do I need to connect a wallet?",
    "Browse markets, run research and try terminal paper orders without a wallet. Sign in to save private experiments and reopen them on another browser. Public Solana position lookup does not require connecting.",
  ],
  [
    "Are the markets and balances real?",
    "Market quotes come from live Polymarket and Jupiter feeds, with Panta on Solana when connected. Missing data stays unavailable. The $10,000 paper balance and practice orders are simulated; they are not wallet funds. Position lookup covers supported Jupiter Prediction positions on Solana.",
  ],
  [
    "What does the AI research verify?",
    "DeepSeek analyzes contract rules and, for supported crypto, Federal Reserve and OpenAI topics, bounded primary-source context. Sources carry retrieval times; context does not prove an outcome or calibrated edge. Unsupported directional forecasts stay withheld.",
  ],
  [
    "How do the three paper strategies work?",
    "The baseline buys YES on eligible high-volume markets. The liquidity filter adds a reported liquidity threshold. The evidence strategy holds cash until independent research is available. Each receives roughly one-third of the paper budget, with entry and position limits. These are test templates, not proven profitable strategies.",
  ],
  [
    "Are experiments automatic or historical backtests?",
    "No. Press Check live markets to record forward observations; checks do not run in the background. Quotes and skipped decisions are saved privately. Ending an experiment leaves positions marked and unsettled; missing quotes stay stale. Simulated slippage is included, trading fees are excluded. A short experiment cannot prove future performance.",
  ],
  [
    "Is the exit estimate a guaranteed payout?",
    "No. It is an estimate based on available bids for your selected size. Depth, prices and fees can change. Missing or insufficient liquidity is shown in the workspace.",
  ],
  [
    "Does ExitCheck automatically trade for me?",
    "No. Agents assist research; all orders are simulated and live execution is disabled. Saved experiments advance only when you press Check live markets. Approving a paper plan never authorizes a funded trade.",
  ],
] as const;

export function LandingPage() {
  return (
    <div className={styles.landing}>
      <a className={styles.skipLink} href="#main-content">
        Skip to content
      </a>
      <header className={styles.header}>
        <Link href="/" className={styles.wordmark} aria-label="ExitCheck home">
          <BrandMark />
          ExitCheck<span className={styles.beta}>BETA</span>
        </Link>
        <nav className={styles.navigation} aria-label="Website navigation">
          <Link href="/trade">
            Trade &amp; Research <span className={styles.beta}>BETA</span>
          </Link>
          <Link href="/experiments">Paper experiments</Link>
          <a href="#product">The product</a>
          <a href="#how-it-works">How it works</a>
          <a href="#questions">FAQ</a>
        </nav>
        <Link className={styles.headerCta} href="/app">
          Open app <Arrow diagonal />
        </Link>
      </header>
      <main id="main-content">
        <section className={styles.hero} aria-labelledby="hero-heading">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              <span className={styles.statusDot} /> PREDICTION RESEARCH. CLARITY
              BEFORE ACTION.
            </p>
            <h1 id="hero-heading">
              Research the trade. <br />
              <span>Understand the exit.</span>
            </h1>
            <p className={styles.heroDescription}>
              Explore live prediction markets, challenge a thesis with concise
              AI analysis, and test a paper budget across three strategies.
              Check available exit liquidity before deciding your next move.
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.primary} href="/trade">
                Explore live markets <Arrow diagonal />
              </Link>
              <Link className={styles.textLink} href="/app">
                Check my positions <Arrow />
              </Link>
              <Link className={styles.textLink} href="/experiments">
                Test a paper budget <Arrow />
              </Link>
            </div>
            <p className={styles.heroFootnote}>
              Explore without a wallet. Sign in to save experiments. No real
              orders.
            </p>
          </div>
          <div className={styles.heroVisual}>
            <div className={styles.visualEyebrow}>
              <span>LIVE QUOTES. SIMULATED TRADES.</span>
              <span aria-hidden="true">↓</span>
            </div>
            <LiveMarketPreview />
            <div className={styles.visualCaption}>
              <span className={styles.captionLine} />
              <p>Read the rules. Compare experiments. Check the exit.</p>
            </div>
          </div>
        </section>
        <div className={styles.proofStrip} aria-label="Product scope">
          <span>
            <span aria-hidden="true">◎</span> Built for Solana
          </span>
          <span>
            <span aria-hidden="true">↗</span> Live Polymarket & Jupiter data
          </span>
          <span>
            <span aria-hidden="true">◈</span> Concise AI rules analysis
          </span>
          <span>
            <span aria-hidden="true">≋</span> Saved paper experiments
          </span>
        </div>
        <section
          id="product"
          className={styles.product}
          aria-labelledby="product-heading"
        >
          <div className={styles.sectionIntro}>
            <p className={styles.eyebrow}>LESS GUESSWORK. MORE CONTEXT.</p>
            <h2 id="product-heading">
              Look beyond the
              <br />
              number on the screen.
            </h2>
            <p>
              Understand contract rules, test a repeatable paper plan and
              compare available bids before making your next decision.
            </p>
          </div>
          <div className={styles.featureGrid}>
            <article>
              <span className={styles.featureIcon} aria-hidden="true">
                ◎
              </span>
              <h3>Research the prediction.</h3>
              <p>
                Search live Polymarket and Jupiter contracts. Get a brief bull
                case, bear case, key risk and next check. Rules-only analysis
                waits when independent evidence is missing.
              </p>
              <span className={styles.featureLabel}>
                RULES, RISKS & NEXT CHECK
              </span>
            </article>
            <article>
              <span className={styles.featureIcon} aria-hidden="true">
                ↗
              </span>
              <h3>Check your way out.</h3>
              <p>
                Compare exit sizes against available bids. See estimated
                proceeds and when there isn’t enough depth.
              </p>
              <span className={styles.featureLabel}>SIZE-AWARE ESTIMATES</span>
            </article>
            <article>
              <span className={styles.featureIcon} aria-hidden="true">
                ⌁
              </span>
              <h3>Compare a paper budget.</h3>
              <p>
                Describe a budget and duration, approve three fixed strategies,
                and save the experiment to your wallet account. Compare cash,
                marked equity and observed drawdown using fresh manual checks.
              </p>
              <span className={styles.featureLabel}>
                PRIVATE, SAVED EXPERIMENTS
              </span>
            </article>
          </div>
        </section>
        <section
          id="how-it-works"
          className={styles.workflow}
          aria-labelledby="workflow-heading"
        >
          <div className={styles.workflowIntro}>
            <p className={styles.eyebrow}>
              FROM A QUESTION TO AN OBSERVED RESULT
            </p>
            <h2 id="workflow-heading">
              Three steps.
              <br />
              Your next move.
            </h2>
            <Link className={styles.primary} href="/experiments">
              Start a paper experiment <Arrow diagonal />
            </Link>
          </div>
          <ol className={styles.steps}>
            <li>
              <span>01</span>
              <div>
                <h3>Choose a live market.</h3>
                <p>
                  Browse live prediction contracts. Read the resolution rules
                  and check the provider and snapshot time.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Challenge the thesis.</h3>
                <p>
                  Read the AI arguments, key risk and available primary-source
                  context. Retrieved facts do not establish a reliable
                  probability edge.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Test a plan. Check the exit.</h3>
                <p>
                  Review a paper order, save its decision receipt and inspect
                  exit bids where supported. Close against available bids or
                  record a provider-confirmed settlement. Neither a marked paper
                  profit nor an exit estimate guarantees a real fill.
                </p>
              </div>
            </li>
          </ol>
        </section>
        <section className={styles.research} aria-labelledby="research-heading">
          <div>
            <p className={styles.eyebrow}>
              ONE BUDGET. THREE FIXED STRATEGIES.
            </p>
            <h2 id="research-heading">What would you test with $300?</h2>
            <p>
              Try: &quot;Test $300 across 3 strategies for 7 days.&quot; Split a
              paper budget between a market baseline, an evidence threshold and
              a liquidity filter. The evidence strategy stays in cash until
              independent research is connected.
            </p>
          </div>
          <Link className={styles.textLink} href="/experiments">
            Compare paper strategies <Arrow />
          </Link>
        </section>
        <section
          id="questions"
          className={styles.faq}
          aria-labelledby="faq-heading"
        >
          <div>
            <p className={styles.eyebrow}>A FEW THINGS TO KNOW</p>
            <h2 id="faq-heading">
              Clear answers.
              <br />
              Clear expectations.
            </h2>
          </div>
          <div className={styles.questions}>
            {questions.map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className={styles.finalCta} aria-labelledby="cta-heading">
          <span className={styles.eyebrow}>CLARITY BEFORE YOU ACT.</span>
          <h2 id="cta-heading">
            Research. Test. Observe.
            <br />
            Decide with context.
          </h2>
          <Link className={styles.primary} href="/experiments">
            Create a paper experiment <Arrow diagonal />
          </Link>
          <p>Your paper budget. Your limits. Your decision.</p>
          <div className={styles.ctaArt} aria-hidden="true">
            <BrandMark />
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <Link href="/" className={styles.wordmark}>
          <BrandMark />
          ExitCheck
        </Link>
        <p>Clarity before you act.</p>
        <div>
          <Link href="/app">
            App <Arrow diagonal />
          </Link>
          <Link href="/experiments">
            Experiments <Arrow diagonal />
          </Link>
          <Link href="/trade">
            Markets <Arrow diagonal />
          </Link>
          <Link href="/discover">
            Find traders <Arrow diagonal />
          </Link>
          <a href="#questions">FAQ</a>
        </div>
        <small>Beta · Estimates can change. Live execution is disabled.</small>
        <PoweredBy />
      </footer>
    </div>
  );
}
