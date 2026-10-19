"use client";
import clsx from "clsx";
import { applyTheme, useClientState, type Settings } from "@/lib/client/store";

function Choice<K extends keyof Settings>({ label, k, options, help }: { label: string; k: K; options: Array<[Settings[K], string]>; help?: string }) {
  const [state, update] = useClientState();
  return (
    <fieldset className="border-b border-line py-4 last:border-b-0">
      <legend className="text-sm font-medium text-ink">{label}</legend>
      {help ? <p className="mt-0.5 text-2xs text-ink-3">{help}</p> : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map(([v, l]) => {
          const on = state.settings[k] === v;
          return (
            <button
              key={String(v)}
              type="button"
              aria-pressed={on}
              onClick={() => {
                update((s) => ({ ...s, settings: { ...s.settings, [k]: v } }));
                if (k === "theme") applyTheme(v as Settings["theme"]);
              }}
              className={clsx("h-8 cursor-pointer rounded-md border px-3 text-sm transition-colors", on ? "border-accent/60 bg-accent-dim text-ink" : "border-line-2 text-ink-2 hover:border-ink-3")}
            >
              {l}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function SettingsForm() {
  const [, update] = useClientState();
  return (
    <div className="rounded-lg border border-line bg-surface px-4">
      <Choice label="Theme" k="theme" options={[["light", "Light"], ["dark", "Dark"], ["system", "Match system"]]} help="Light follows Apple’s default; dark suits long sessions in dim rooms." />
      <Choice label="Time display" k="timeDisplay" options={[["et", "Exchange time (ET)"], ["local", "Local time"], ["utc", "UTC"]]} help="Storage is always UTC; this only changes what you see." />
      <Choice label="Feed ranking" k="ranking" options={[["market", "Market-wide catalysts"], ["watchlist", "Prioritize my watchlist"]]} help="Watchlist priority raises the watchlist weight in the documented ranking function." />
      <Choice label="Default horizon on cards" k="defaultHorizon" options={[["1h", "1 trading hour"], ["next_session", "Next session"], ["5_sessions", "5 sessions"]]} />
      <div className="py-4">
        <button type="button" onClick={() => update(() => ({ watchlist: [], bookmarks: [], followed: [], rules: [], deliveries: [], savedViews: [], settings: { theme: "light", timeDisplay: "et", ranking: "market", defaultHorizon: "next_session", density: "comfortable" } }))} className="cursor-pointer text-sm text-neg hover:underline">
          Clear all locally stored data
        </button>
        <p className="mt-1 text-2xs text-ink-3">Removes watchlists, bookmarks, alert rules and settings from this browser.</p>
      </div>
    </div>
  );
}
