import { TopNav } from "@/components/terminal/TopNav";
import { AGENTS } from "@/lib/committee";
import {
  AnimatedHero,
  AnimatedLogoStrip,
  AnimatedCommittee,
  AnimatedProcess,
} from "@/components/marketing/AnimatedSections";

export default function Home() {
  return (
    <>
      {/* announcement bar */}
      <div className="w-full border-b border-graphite bg-void py-2 text-center">
        <p className="text-body-sm text-bone">
          AICOS is in private beta for funds and family offices.{" "}
          <a href="/terminal" className="font-medium text-lilac hover:underline">
            Request access →
          </a>
        </p>
      </div>

      <TopNav variant="marketing" />

      <main className="flex-1">
        <AnimatedHero />
        <AnimatedLogoStrip />
        <AnimatedCommittee />
        <AnimatedProcess />
      </main>

      <footer className="border-t border-graphite">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-4 px-5 py-10 sm:flex-row">
          <p className="text-caption text-mute">
            © 2026 AICOS — AI Investment Committee OS
          </p>
          <p className="text-caption text-mute">
            For research and decision support. Not investment advice.
          </p>
        </div>
      </footer>
    </>
  );
}
