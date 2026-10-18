"use client";

export default function ProductError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-lg rounded-lg border border-neg/40 bg-neg-dim p-5">
      <h1 className="text-md font-semibold text-ink">This view failed to load</h1>
      <p className="mt-1 text-sm text-ink-2">A data source or computation failed. Nothing was substituted. {error.digest ? <span className="font-mono text-2xs text-ink-3">Ref {error.digest}</span> : null}</p>
      <button type="button" onClick={reset} className="mt-4 inline-flex h-8 cursor-pointer items-center rounded-md border border-line-2 bg-surface px-3 text-sm hover:bg-surface-2">
        Try again
      </button>
    </div>
  );
}
