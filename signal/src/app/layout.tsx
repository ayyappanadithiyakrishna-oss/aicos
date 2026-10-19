import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// SF Pro via the system stack on Apple devices; Inter is the closest fallback elsewhere.
const sans = Inter({ subsets: ["latin"], variable: "--ff-sans", display: "swap" });

export const metadata: Metadata = {
  title: { default: "SIGNAL — Market impact intelligence", template: "%s · SIGNAL" },
  description:
    "Source-grounded explanations of how news, disclosures and macro releases transmit to exposed securities — with uncertainty, provenance and forecasts frozen at publication.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
  ],
};

// Applies the saved theme before first paint (dark is the default).
const themeScript = `(function(){try{var s=JSON.parse(localStorage.getItem('signal:v1')||'{}').settings||{};var t=s.theme||'light';if(t==='system'){t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='light'}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light" className={sans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh bg-bg text-ink">{children}</body>
    </html>
  );
}
