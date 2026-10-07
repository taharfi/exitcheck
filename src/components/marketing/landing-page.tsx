import Link from "next/link";
import { BrandMark } from "@/components/brand";
import { ExitIllustration } from "./exit-illustration";
import styles from "./landing.module.css";

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <span aria-hidden="true">{diagonal ? "↗" : "→"}</span>;
}

const questions = [
  [
    "Do I need to connect a wallet?",
    "You can look up a public Solana address without connecting a wallet or signing a message. Wallet connection is optional for checking positions.",
  ],
  [
    "Which positions can I check?",
    "ExitCheck currently reads supported Jupiter Prediction positions on Solana. An empty result does not describe every asset or prediction position in your wallet.",
  ],
  [
    "Is the exit estimate a guaranteed payout?",
    "No. It is an estimate based on available bids for your selected size. Depth, prices and fees can change. Missing or insufficient liquidity is shown in the workspace.",
  ],
  [
    "Does ExitCheck automatically trade for me?",
    "No. This version focuses on position lookup, exit estimates and research. Live execution is disabled, and virtual copy-trading tools do not place real trades.",
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
              <span className={styles.statusDot} /> A CLEARER VIEW OF SOLANA
              PREDICTIONS
            </p>
            <h1 id="hero-heading">
              Know your <br />
              position. <br />
              <span>
                Understand <br />
                your exit.
              </span>
            </h1>
            <p className={styles.heroDescription}>
              Your position has a price. Getting out has a cost. See your
              prediction positions and check what your exit size could actually
              return.
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.primary} href="/app">
                Check my positions <Arrow diagonal />
              </Link>
              <a className={styles.textLink} href="#how-it-works">
                See how it works <Arrow />
              </a>
            </div>
            <p className={styles.heroFootnote}>
              Start with a public wallet address. No signature needed.
            </p>
          </div>
          <div className={styles.heroVisual}>
            <div className={styles.visualEyebrow}>
              <span>THE PRICE IS ONLY PART OF THE PICTURE</span>
              <span aria-hidden="true">↓</span>
            </div>
            <ExitIllustration />
            <div className={styles.visualCaption}>
              <span className={styles.captionLine} />
              <p>Try a different size. Watch the estimate change.</p>
            </div>
          </div>
        </section>
        <div className={styles.proofStrip} aria-label="Product scope">
          <span>
            <span aria-hidden="true">◎</span> Built for Solana
          </span>
          <span>
            <span aria-hidden="true">↗</span> Jupiter Prediction positions
          </span>
          <span>
            <span aria-hidden="true">◈</span> Read-only position lookup
          </span>
          <span>
            <span aria-hidden="true">≋</span> Estimates based on bid depth
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
              A reference price values a position. An exit check looks at the
              bids available for the amount you want to sell.
            </p>
          </div>
          <div className={styles.featureGrid}>
            <article>
              <span className={styles.featureIcon} aria-hidden="true">
                ◎
              </span>
              <h3>See what you hold.</h3>
              <p>
                Bring supported positions into one workspace. Inspect the event,
                outcome, size and current state.
              </p>
              <span className={styles.featureLabel}>POSITION CLARITY</span>
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
              <h3>Know the limits.</h3>
              <p>
                Review fees, freshness and missing data alongside an estimate,
                before deciding your next move.
              </p>
              <span className={styles.featureLabel}>CONTEXT BEFORE ACTION</span>
            </article>
          </div>
        </section>
        <section
          id="how-it-works"
          className={styles.workflow}
          aria-labelledby="workflow-heading"
        >
          <div className={styles.workflowIntro}>
            <p className={styles.eyebrow}>FROM WALLET TO A CLEARER DECISION</p>
            <h2 id="workflow-heading">
              Three steps.
              <br />
              Your next move.
            </h2>
            <Link className={styles.primary} href="/app">
              Open the workspace <Arrow diagonal />
            </Link>
          </div>
          <ol className={styles.steps}>
            <li>
              <span>01</span>
              <div>
                <h3>Bring an address.</h3>
                <p>
                  Paste a public Solana wallet address or connect your wallet.
                  Position lookup needs no signature.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Choose a position and size.</h3>
                <p>
                  Inspect a supported prediction position. Check a partial exit
                  or the full amount against available bids.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Read the estimate.</h3>
                <p>
                  Review proceeds, liquidity and costs. An estimate gives you
                  context; it doesn’t guarantee a fill.
                </p>
              </div>
            </li>
          </ol>
        </section>
        <section className={styles.research} aria-labelledby="research-heading">
          <div>
            <p className={styles.eyebrow}>ROOM TO EXPLORE</p>
            <h2 id="research-heading">Curious about copying traders?</h2>
            <p>
              Explore public wallets, replay a virtual budget and observe a
              paper portfolio. Keep assumptions and data gaps in view.
            </p>
          </div>
          <Link className={styles.textLink} href="/research">
            Explore research tools <Arrow />
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
            Check the exit.
            <br />
            Then choose your move.
          </h2>
          <Link className={styles.primary} href="/app">
            Check my positions <Arrow diagonal />
          </Link>
          <p>Your address. Your positions. Your decision.</p>
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
          <Link href="/research">
            Research <Arrow diagonal />
          </Link>
          <a href="#questions">FAQ</a>
        </div>
        <small>Beta · Estimates can change. Live execution is disabled.</small>
      </footer>
    </div>
  );
}
