import type { Metadata } from "next";
import { OverviewWorkspace } from "@/features/copy-trading/components/overview-workspace";

export const metadata: Metadata = {
  title: "Copy-trading research | ExitCheck",
};

export default function Page() {
  return <OverviewWorkspace />;
}
