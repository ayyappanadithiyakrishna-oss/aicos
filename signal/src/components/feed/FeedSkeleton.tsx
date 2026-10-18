export function FeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading feed">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-lg border border-line bg-surface p-4 sm:p-5">
          <div className="skeleton h-3 w-48" />
          <div className="skeleton mt-3 h-5 w-[90%]" />
          <div className="skeleton mt-2 h-5 w-[70%]" />
          <div className="skeleton mt-4 h-3 w-[60%]" />
          <div className="mt-4 flex gap-2">
            <div className="skeleton h-10 w-40" />
            <div className="skeleton h-10 w-40" />
            <div className="skeleton hidden h-10 w-40 sm:block" />
          </div>
        </div>
      ))}
    </div>
  );
}
