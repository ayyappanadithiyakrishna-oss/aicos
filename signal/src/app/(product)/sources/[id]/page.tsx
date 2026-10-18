import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSource } from "@/lib/data/service";
import { dateTimeET } from "@/lib/format";
import { DemoChip, Panel } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Source document" };

/** Synthetic source documents for demo evidence links (live sources link to the original publisher). */
export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9-]{2,80}$/.test(id)) notFound();
  const doc = await getSource(id);
  if (!doc) notFound();
  return (
    <div className="mx-auto max-w-[760px]">
      <nav className="mb-3 text-2xs text-ink-3">
        <Link href="/" className="hover:text-ink">Intelligence feed</Link> / Source document
      </nav>
      <Panel className="p-5">
        <div className="flex flex-wrap items-center gap-2 text-2xs text-ink-3">
          <span className="font-medium text-ink-2">{doc.publisher}</span> · {doc.kind.replace("_", " ")} · {dateTimeET(doc.publishedAt)}
          {doc.isSynthetic ? <DemoChip /> : null}
        </div>
        <h1 className="mt-2 text-lg font-semibold">{doc.title}</h1>
        <p className="mt-3 text-sm text-ink-2">{doc.excerpt}</p>
        {doc.structuredText !== `${doc.title} ${doc.excerpt}` ? (
          <div className="mt-4 rounded-md border border-line bg-surface-2 p-3">
            <div className="text-2xs font-medium text-ink-3">Structured fields (verifiable text used by evidence checks)</div>
            <p className="mt-1 font-mono text-xs text-ink-2">{doc.structuredText}</p>
          </div>
        ) : null}
        {doc.injectionFlags.length ? (
          <p className="mt-4 rounded-md border border-warn/40 bg-warn-dim p-3 text-xs text-warn">
            This document contains instruction-like text. SIGNAL treats provider content as untrusted data: it was flagged and ignored, never followed.
          </p>
        ) : null}
        <p className="mt-4 text-2xs text-ink-3">
          {doc.isSynthetic ? "Synthetic document created for the demo. It describes a fictional event and is not a real publication." : "Stored metadata only."}
        </p>
        {doc.eventId ? (
          <Link href={`/events/${doc.eventId}`} className="mt-3 inline-block text-xs text-accent hover:underline">
            Open the event dossier
          </Link>
        ) : null}
      </Panel>
    </div>
  );
}
