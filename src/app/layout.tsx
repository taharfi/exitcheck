import type { Metadata } from "next";
import { WalletContext } from "@/components/wallet-provider";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
export const metadata: Metadata = {
  title: "ExitCheck — Clarity before you act",
  description:
    "Explore live prediction markets, analyze rules with AI, compare private paper experiments and check Solana prediction exit liquidity. Live execution is disabled.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletContext>{children}</WalletContext>
      </body>
    </html>
  );
}
