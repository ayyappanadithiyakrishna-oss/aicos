export default function Loading() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-6 w-56" />
      <div className="skeleton h-4 w-96 max-w-full" />
      <div className="skeleton mt-4 h-48 w-full" />
      <div className="skeleton h-32 w-full" />
    </div>
  );
}
