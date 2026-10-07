import Link from "next/link";
import { AppHeader } from "@/components/app-header";
const tools = [
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
    "/exit",
    "Exit checker",
    "Inspect positions and size-aware exit estimates from available order-book depth.",
  ],
  [
    "/paper",
    "Browser paper portfolio",
    "Explore a virtual portfolio stored in this browser while the tab is running.",
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
            Supporting tools for specific research questions. Start with Find
            traders and Test my budget for the core workflow.
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
