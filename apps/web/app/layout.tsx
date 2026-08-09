import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "TradeOS — personal trading terminal",
  description:
    "Personal investment & trading intelligence platform. Analysis and plans only — no automatic execution.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-(--color-bg) text-(--color-text)">
        {children}
      </body>
    </html>
  );
}
