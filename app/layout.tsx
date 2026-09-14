import type { Metadata, Viewport } from "next";
import "./globals.css";
import WorkSectionPageBridge from "./work-section-page-bridge";

export const metadata: Metadata = {
  title: "Dylan’s Toolbox",
  description: "Put it down. Pick up only what matters now.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Toolbox", statusBarStyle: "default" },
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f8fafc" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}<WorkSectionPageBridge/></body>
    </html>
  );
}
