import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/primitives";
import { LocalNotice } from "@/components/personal/LocalNotice";
import { AlertRules } from "@/components/personal/AlertRules";

export const metadata: Metadata = { title: "Alerts" };

export default function AlertsPage() {
  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader title="Alerts" description="Rule-based in-app alerts with deduplication by event cluster, per-rule hourly throttling, pause and digest." />
      <LocalNotice what="Alert rules and deliveries" />
      <AlertRules />
    </div>
  );
}
