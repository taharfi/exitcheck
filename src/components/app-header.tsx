"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand";
const navigation = [
  ["/app", "Positions & exits"],
  ["/agent", "Copy agent"],
  ["/trade", "Trade & Research"],
  ["/experiments", "Paper experiments"],
  ["/discover", "Find traders"],
  ["/lab", "Advanced tools"],
] as const;
export function AppHeader({
  actions,
  badge,
}: {
  actions?: ReactNode;
  badge?: string;
}) {
  const pathname = usePathname();
  return (
    <header className="topbar product-shell">
      <Link className="brand" href="/" aria-label="ExitCheck home">
        <BrandMark className="shell-brand-mark" />
        ExitCheck{badge && <span className="beta">{badge}</span>}
      </Link>
      <p className="shell-purpose">Clarity before you act.</p>
      <nav aria-label="Main navigation">
        {navigation.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            aria-current={
              pathname === href ||
              (href === "/app" && pathname === "/exit") ||
              (href === "/lab" &&
                [
                  "/research",
                  "/compare",
                  "/shadow",
                  "/bot",
                  "/backtest",
                  "/paper",
                ].includes(pathname))
                ? "page"
                : undefined
            }
          >
            {label}
            {href === "/trade" && <span className="beta">BETA</span>}
          </Link>
        ))}
      </nav>
      {actions && <div className="shell-actions">{actions}</div>}
      <div className="shell-status">
        <span /> Research workspace<p>Solana prediction markets</p>
      </div>
    </header>
  );
}
