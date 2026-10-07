import type { Metadata } from "next";
import { WalletContext } from "@/components/wallet-provider";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
export const metadata: Metadata = {
  title: "ExitCheck — Clarity before you act",
  description:
    "Understand your Solana prediction positions. Check exit sizes, available liquidity and estimated proceeds with ExitCheck.",
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
