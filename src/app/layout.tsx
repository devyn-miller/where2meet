import type { Metadata, Viewport } from "next";
import { THEME_BOOT_SCRIPT } from "@/lib/client/prefs";
import "./globals.css";

export const metadata: Metadata = {
  title: "where2meet",
  description: "Find a fair place to meet. Everyone drops a pin; the center updates live.",
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#14171b" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
