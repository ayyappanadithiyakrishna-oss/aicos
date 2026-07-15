import { TopNav } from "@/components/terminal/TopNav";
import { TerminalApp } from "@/components/terminal/TerminalApp";

export const metadata = {
  title: "Terminal — AICOS",
};

export default function TerminalPage() {
  return (
    <>
      <TopNav variant="app" />
      <main className="flex-1">
        <TerminalApp initial="NVDA" />
      </main>
    </>
  );
}
