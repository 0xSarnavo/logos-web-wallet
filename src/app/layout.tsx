import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Logos Wallet",
  description:
    "Browser wallet for the Logos Execution Zone — create accounts, transfer the native token, check balances, and run private transfers with local proof generation.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen font-mono">{children}</body>
    </html>
  );
}
