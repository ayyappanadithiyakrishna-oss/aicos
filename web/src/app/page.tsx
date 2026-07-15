import { TopNav } from "@/components/terminal/TopNav";
import {
  AnimatedHero,
  AnimatedLogoStrip,
  AnimatedCommittee,
  AnimatedCapabilities,
  AnimatedProcess,
} from "@/components/marketing/AnimatedSections";

export default function Home() {
  return (
    <>
      {/* announcement bar */}
      <div className="w-full border-b border-graphite bg-void py-2.5 text-center">
        <p className="text-body-sm text-ash">
          Now trading live on Alpaca paper.{" "}
          <a href="/terminal" className="font-medium text-cobalt hover:underline">
            Open the terminal →
          </a>
        </p>
      </div>

      <TopNav variant="marketing" />

      <main className="flex-1">
        <AnimatedHero />
        <AnimatedLogoStrip />
        <AnimatedCommittee />
        <AnimatedCapabilities />
        <AnimatedProcess />
      </main>

      <footer className="border-t border-graphite">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-4 px-5 py-10 sm:flex-row">
          <p className="text-caption text-mute">
            © 2026 AICOS — AI Investment Committee OS
          </p>
          <p className="text-caption text-mute">
            Alpaca paper trading. For research and decision support — not investment advice.
          </p>
        </div>
      </footer>
    </>
  );
}
