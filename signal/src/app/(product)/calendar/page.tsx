import Link from "next/link";
import type { Metadata } from "next";
import { getCalendar, getRibbon } from "@/lib/data/service";
import { CalendarList } from "@/components/calendar/CalendarList";
import { EmptyState, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Catalyst Calendar" };
export const revalidate = 300;

export default async function CalendarPage() {
  const [items, ribbon] = await Promise.all([getCalendar(), getRibbon()]);
  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader title="Catalyst calendar" description="Scheduled earnings, macro releases and corporate catalysts. Dates the issuer has not confirmed are marked; times shown in your chosen zone with exchange time alongside." />
      {items.length ? (
        <CalendarList items={items} asOf={ribbon.mode.asOf} />
      ) : (
        <EmptyState
          title="No catalyst calendar connected"
          body={<>Live mode needs a licensed calendar source (economic and earnings calendars). See <Link href="/status" className="text-accent hover:underline">Data Status</Link>.</>}
        />
      )}
    </div>
  );
}
