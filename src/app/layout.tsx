import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/pwa/sw-register";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tradosphere Wealth Management",
  description:
    "Educational, simulation-only wealth management platform — market intelligence, paper trading, and AI-assisted coaching.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Tradosphere",
  },
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
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
