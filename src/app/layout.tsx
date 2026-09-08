import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tradosphere Wealth Management",
  description:
    "Educational, simulation-only wealth management platform — market intelligence, paper trading, and AI-assisted coaching.",
};

/**
 * `viewportFit: "cover"` lets the app paint under the Android gesture bar;
 * the bottom nav compensates with `env(safe-area-inset-bottom)`. Zoom is
 * deliberately left unrestricted — a trading app full of small numbers is
 * exactly where pinch-to-zoom matters.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0d0e17",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full dark`}>
      <body className="min-h-full flex flex-col antialiased bg-bg text-text">
        {children}
      </body>
    </html>
  );
}
