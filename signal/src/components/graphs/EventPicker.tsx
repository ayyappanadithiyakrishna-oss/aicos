"use client";
import { useRouter } from "next/navigation";

export function EventPicker({ options, value }: { options: Array<{ id: string; label: string }>; value: string }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-xs text-ink-3">
      <span>Event</span>
      <select value={value} onChange={(e) => router.push(`/impact-map?event=${encodeURIComponent(e.target.value)}`)} className="h-8 max-w-[min(420px,80vw)] cursor-pointer rounded-md border border-line-2 bg-surface px-2 text-sm text-ink">
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
