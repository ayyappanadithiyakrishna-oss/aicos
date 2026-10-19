"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { PanelLeftClose, PanelLeft } from "lucide-react";
import { useSyncExternalStore } from "react";
import { NAV } from "./nav";

export function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/events");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavList({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname() ?? "/";
  const groups = [...new Set(NAV.map((n) => n.group))];
  return (
    <nav aria-label="Primary" className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g}>
          {!collapsed ? <div className="mb-1 px-2.5 text-2xs font-semibold text-ink-3">{g}</div> : <div className="mx-2.5 mb-1 h-px bg-line" />}
          <ul className="flex flex-col gap-px">
            {NAV.filter((n) => n.group === g).map((n) => {
              const active = isActive(pathname, n.href);
              const Icon = n.icon;
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? n.label : undefined}
                    className={clsx(
                      "press group flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors duration-150",
                      active ? "bg-surface-3 font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    <Icon aria-hidden className={clsx("size-4 shrink-0", active ? "text-accent" : "text-ink-3 group-hover:text-ink-2")} strokeWidth={1.75} />
                    {!collapsed ? <span className="truncate">{n.label}</span> : <span className="sr-only">{n.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

const navListeners = new Set<() => void>();
function readCollapsed(): boolean {
  try {
    return localStorage.getItem("signal:nav") === "collapsed";
  } catch {
    return false;
  }
}
function subscribeNav(l: () => void) {
  navListeners.add(l);
  return () => navListeners.delete(l);
}

export function SideNav() {
  const collapsed = useSyncExternalStore(subscribeNav, readCollapsed, () => false);
  const toggle = () => {
    try {
      localStorage.setItem("signal:nav", collapsed ? "open" : "collapsed");
    } catch {
      /* storage blocked: the toggle simply does not persist */
    }
    for (const l of navListeners) l();
  };
  return (
    <aside
      className={clsx(
        "sticky top-[var(--chrome-h)] hidden h-[calc(100dvh-var(--chrome-h))] shrink-0 flex-col material-side border-r border-line py-3 lg:flex",
        collapsed ? "w-14 px-1.5" : "w-[228px] px-2",
      )}
      style={{ zIndex: "var(--z-nav)" }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <NavList collapsed={collapsed} />
      </div>
      <button type="button" onClick={toggle} className="mt-2 flex h-8 cursor-pointer items-center gap-2 rounded-md px-2.5 text-xs text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}>
        {collapsed ? <PanelLeft className="mx-auto size-4" /> : <PanelLeftClose className="size-4" />}
        {!collapsed ? "Collapse" : null}
      </button>
    </aside>
  );
}
