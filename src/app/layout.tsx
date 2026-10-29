import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { RouteTransitionProvider } from "@/components/shell/RouteTransition";
import { THEME_SCRIPT } from "@/lib/useDark";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RoutePulse",
  description: "Simulated climate impacts on Tamil Nadu road travel. Synthetic data, not a real-world forecast.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body><RouteTransitionProvider>{children}</RouteTransitionProvider></body>
    </html>
  );
}
