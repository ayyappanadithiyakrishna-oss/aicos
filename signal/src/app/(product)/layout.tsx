import { DemoBanner } from "@/components/shell/DemoBanner";
import { PulseRibbon } from "@/components/shell/PulseRibbon";
import { SideNav } from "@/components/shell/SideNav";
import { TopBar } from "@/components/shell/TopBar";
import { getRibbon } from "@/lib/data/service";

export const revalidate = 60;

export default async function ProductLayout({ children }: { children: React.ReactNode }) {
  const ribbon = await getRibbon();
  const demo = ribbon.mode.mode === "demo";
  return (
    <div className="min-h-dvh" style={{ ["--chrome-h" as string]: demo ? "4.5rem" : "2.75rem" }}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink" style={{ zIndex: "var(--z-toast)" }}>
        Skip to content
      </a>
      <div className="sticky top-0" style={{ zIndex: "var(--z-sticky)" }}>
        {demo ? <DemoBanner asOf={ribbon.mode.asOf} /> : null}
        <TopBar mode={ribbon.mode} />
      </div>
      <div className="flex">
        <SideNav />
        <div className="min-w-0 flex-1">
          <PulseRibbon items={ribbon.items} mode={ribbon.mode.mode} />
          <main id="main" className="mx-auto w-full max-w-[1560px] px-4 py-5 sm:px-6">
            {children}
          </main>
          <footer className="mx-auto w-full max-w-[1560px] border-t border-line px-4 py-4 text-2xs text-ink-3 sm:px-6">
            Informational market research, not investment advice. Model estimates are conditional views, not outcomes.{" "}
            <a href="/methodology" className="text-ink-2 underline underline-offset-2">
              Methodology &amp; data licensing
            </a>
          </footer>
        </div>
      </div>
    </div>
  );
}
