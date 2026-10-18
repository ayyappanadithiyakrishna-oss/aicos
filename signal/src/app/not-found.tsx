import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-3">404</p>
      <h1 className="mt-2 text-xl font-semibold">Not in this feed</h1>
      <p className="mt-2 text-sm text-ink-2">The event, ticker or page you asked for does not exist in the current mode. Demo and live data never overlap, so links from one mode do not resolve in the other.</p>
      <Link href="/" className="mt-5 inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-ink">
        Back to the feed
      </Link>
    </main>
  );
}
