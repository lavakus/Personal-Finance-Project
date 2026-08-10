import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import "./globals.css";

/**
 * Fonts are self-hosted by next/font — no network request at runtime, no
 * layout shift. Previously globals.css asked for "Inter"/"JetBrains Mono"
 * without ever loading them, so every page silently fell back to the OS
 * default and the whole typographic identity was missing.
 */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "TradeOS — personal trading terminal",
  description:
    "Personal investment & trading intelligence platform. Analysis and plans only — no automatic execution.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh bg-(--color-bg) text-(--color-text) antialiased">
        {children}
      </body>
    </html>
  );
}
