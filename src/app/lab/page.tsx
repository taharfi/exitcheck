import Link from "next/link";
import { AppHeader } from "@/components/app-header";
const tools = [
  [
    "/strategy-study",
    "Prediction strategy study",
    "Record a fixed Solana market cohort, compare fixed strategies chronologically and inspect a mock execution test.",
  ],
  [
    "/research",
    "Copy-trading overview",
    "Start with a budget, compare public traders and observe before following.",
  ],
  [
    "/compare",
    "Compare trader budgets",
    "Compare historical records and shared exposure for your own budget.",
  ],
  [
    "/shadow",
    "Persistent paper observation",
    "Track selected traders with recorded entry and skip explanations across visits.",
  ],
  [
    "/backtest",
    "Allocation experiments",
    "Compare three historical allocation rules under the same modeled costs.",
  ],
  [
    "/bot",
    "Market signal research",
    "Inspect recorded markets and fixed signal rules. Signal watching does not execute trades.",
  ],
  [
    "/paper",
    "Legacy browser copy sandbox",
    "Review the older browser-only copy simulation. Use persistent observation for new trader tracking.",
  ],
] as const;
export default function Page() {
  return (
    <>
      <AppHeader />
      <main className="paper-main">
        <div className="paper-intro">
          <p className="eyebrow">ADVANCED TOOLS</p>
          <h1>Go deeper into the evidence.</h1>
          <p>
            Supporting tools for specific research questions. Use Trade &
            Research for manual paper orders, or Find traders and Copy agent to
            observe public traders.
          </p>
        </div>
        <div className="lab-grid">
          {tools.map(([href, title, description]) => (
            <Link key={href} href={href} className="paper-card">
              <h2>{title}</h2>
              <p>{description}</p>
              <strong>Open tool →</strong>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
