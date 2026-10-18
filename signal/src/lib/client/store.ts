"use client";
/**
 * Per-browser conveniences (watchlist, bookmarks, alert rules, settings). Stored in localStorage
 * with every access guarded; the UI renders correctly when storage is unavailable. Nothing here
 * is durable account data — the UI says so wherever it is used.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { AlertDelivery, AlertRule } from "@/lib/alerts/match";

export interface Settings {
  theme: "dark" | "light" | "system";
  timeDisplay: "et" | "local" | "utc";
  ranking: "market" | "watchlist";
  defaultHorizon: "1h" | "next_session" | "5_sessions";
  density: "comfortable" | "compact";
}

export interface ClientState {
  watchlist: string[];
  bookmarks: Array<{ id: string; title: string; at: string }>;
  followed: string[];
  rules: AlertRule[];
  deliveries: AlertDelivery[];
  settings: Settings;
  savedViews: Array<{ id: string; name: string; query: string }>;
}

const KEY = "signal:v1";
export const DEFAULT_SETTINGS: Settings = { theme: "dark", timeDisplay: "et", ranking: "market", defaultHorizon: "next_session", density: "comfortable" };
const EMPTY: ClientState = { watchlist: [], bookmarks: [], followed: [], rules: [], deliveries: [], settings: DEFAULT_SETTINGS, savedViews: [] };

let cache: ClientState | null = null;
const listeners = new Set<() => void>();

function read(): ClientState {
  if (cache) return cache;
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    const parsed = raw ? (JSON.parse(raw) as Partial<ClientState>) : {};
    cache = { ...EMPTY, ...parsed, settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) } };
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function write(next: ClientState) {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked or full: keep the in-memory copy for this session only.
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

export function useClientState(): [ClientState, (fn: (s: ClientState) => ClientState) => void] {
  const state = useSyncExternalStore(subscribe, read, () => EMPTY);
  const update = useCallback((fn: (s: ClientState) => ClientState) => write(fn(read())), []);
  return [state, update];
}

export function storageAvailable(): boolean {
  try {
    const k = "signal:probe";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function applyTheme(theme: Settings["theme"]) {
  const root = document.documentElement;
  const resolved = theme === "system" ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : theme;
  root.dataset.theme = resolved;
}
