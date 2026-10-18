import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/primitives";
import { SettingsForm } from "@/components/personal/SettingsForm";
import { LocalNotice } from "@/components/personal/LocalNotice";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-[760px]">
      <PageHeader title="Settings" description="Display preferences for this browser." />
      <LocalNotice what="Settings" />
      <SettingsForm />
    </div>
  );
}
