import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/primitives";
import { LocalNotice } from "@/components/personal/LocalNotice";
import { SavedList } from "@/components/personal/SavedList";

export const metadata: Metadata = { title: "Saved Research" };

export default function SavedPage() {
  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader title="Saved research" description="Bookmarked events. Each bookmark links to the frozen dossier, so you can compare the original view with how it resolved." />
      <LocalNotice what="Bookmarks" />
      <SavedList />
    </div>
  );
}
