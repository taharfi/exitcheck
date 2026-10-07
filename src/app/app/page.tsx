import type { Metadata } from "next";
import { ExitWorkspace } from "@/features/exits/components/exit-workspace";

export const metadata: Metadata = { title: "Positions & exits | ExitCheck" };

export default function Page() {
  return <ExitWorkspace />;
}
