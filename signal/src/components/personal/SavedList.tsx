"use client";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { useClientState } from "@/lib/client/store";
import { EmptyState, buttonClass } from "@/components/ui/primitives";

export function SavedList() {
  const [state, update] = useClientState();
  if (!state.bookmarks.length) {
    return <EmptyState title="No saved research" body="Use the bookmark button on any card (or press b while it is focused) to save it here." action={<Link href="/" className={buttonClass("primary")}>Browse the feed</Link>} />;
  }
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
      {state.bookmarks.map((b) => (
        <li key={b.id} className="flex items-start gap-3 px-4 py-3">
          <div className="min-w-0">
            <Link href={`/events/${b.id}`} className="font-serif text-md text-ink hover:text-accent-strong">
              {b.title}
            </Link>
            <div className="num mt-0.5 font-mono text-2xs text-ink-3">saved {new Date(b.at).toLocaleString()}</div>
          </div>
          <button type="button" onClick={() => update((s) => ({ ...s, bookmarks: s.bookmarks.filter((x) => x.id !== b.id) }))} aria-label="Remove bookmark" className="ml-auto inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-neg">
            <Trash2 className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}
