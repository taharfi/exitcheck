import type { Metadata } from "next";
import { TradeTerminal } from "@/features/trade/terminal";
export const metadata: Metadata = {
  title: "ExitCheck Agentic Trade & Prediction Terminal",
  description:
    "Explore live prediction markets, compare cited research and practice with guarded paper orders.",
};
export default function TradePage() {
  return <TradeTerminal />;
}
