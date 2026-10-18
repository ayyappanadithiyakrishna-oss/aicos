"use client";
import { useSyncExternalStore } from "react";
import { storageAvailable } from "@/lib/client/store";

const noop = () => () => {};

export function LocalNotice({ what }: { what: string }) {
  const ok = useSyncExternalStore(noop, storageAvailable, () => true);
  return (
    <p className="mb-4 rounded-md border border-line bg-surface px-3 py-2 text-xs text-ink-2" role="note">
      {ok
        ? `${what} are stored in this browser only — no account, not synced, and cleared with your site data. Accounts with durable storage require an identity provider, which is not configured on this deployment.`
        : `This browser is blocking storage, so ${what.toLowerCase()} last only until you close the tab.`}
    </p>
  );
}
