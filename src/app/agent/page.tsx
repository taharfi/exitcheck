import type { Metadata } from "next";
import { AgentWorkspace } from "@/features/copy-trading/components/agent-workspace";
export const metadata: Metadata = {
  title: "Copy agent | ExitCheck",
  description:
    "Watch new trader fills and review preliminary entries within your planning budget. Observation stage; no funded execution.",
};
export default function Page() {
  return <AgentWorkspace />;
}
