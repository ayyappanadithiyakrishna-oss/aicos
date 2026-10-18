import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Instrument_Sans, Newsreader } from "next/font/google";
import "./globals.css";

const sans = Instrument_Sans({ subsets: ["latin"], variable: "--ff-sans", display: "swap" });
const serif = Newsreader({ subsets: ["latin"], variable: "--ff-serif", display: "swap", weight: ["400", "500", "600"], style: ["normal"] });
const mono = IBM_Plex_Mono({ subsets: ["latin"], variable: "--ff-mono", display: "swap", weight: ["400", "500", "600"] });

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
    { media: "(prefers-color-scheme: dark)", color: "#090d13" },
    { media: "(prefers-color-scheme: light)", color: "#f4f6f9" },
  ],
};

// Applies the saved theme before first paint (dark is the default).
const themeScript = `(function(){try{var s=JSON.parse(localStorage.getItem('signal:v1')||'{}').settings||{};var t=s.theme||'dark';if(t==='system'){t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='dark'}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" className={`${sans.variable} ${serif.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh bg-bg text-ink">{children}</body>
    </html>
  );
}
