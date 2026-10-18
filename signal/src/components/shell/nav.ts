import {
  Activity,
  BarChart3,
  Bell,
  BookmarkCheck,
  CalendarClock,
  FileText,
  FlaskConical,
  Gauge,
  Globe2,
  LineChart,
  Network,
  Rss,
  Settings,
  Star,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group: string;
  shortcut?: string;
}

export const NAV: NavItem[] = [
  { href: "/", label: "Intelligence Feed", icon: Rss, group: "Intelligence", shortcut: "g f" },
  { href: "/pulse", label: "Market Pulse", icon: Activity, group: "Intelligence", shortcut: "g p" },
  { href: "/impact-map", label: "Impact Map", icon: Network, group: "Intelligence", shortcut: "g m" },
  { href: "/ticker", label: "Ticker Intelligence", icon: LineChart, group: "Intelligence", shortcut: "g t" },
  { href: "/macro", label: "Macro Radar", icon: Globe2, group: "Calendar & disclosures", shortcut: "g r" },
  { href: "/filings", label: "Earnings & Filings", icon: FileText, group: "Calendar & disclosures", shortcut: "g e" },
  { href: "/calendar", label: "Catalyst Calendar", icon: CalendarClock, group: "Calendar & disclosures", shortcut: "g c" },
  { href: "/forecast-lab", label: "Forecast Lab", icon: FlaskConical, group: "Models", shortcut: "g l" },
  { href: "/scorecard", label: "Model Scorecard", icon: BarChart3, group: "Models", shortcut: "g s" },
  { href: "/watchlists", label: "Watchlists", icon: Star, group: "Personal", shortcut: "g w" },
  { href: "/alerts", label: "Alerts", icon: Bell, group: "Personal", shortcut: "g a" },
  { href: "/saved", label: "Saved Research", icon: BookmarkCheck, group: "Personal" },
  { href: "/status", label: "Data Status", icon: Gauge, group: "System", shortcut: "g d" },
  { href: "/settings", label: "Settings", icon: Settings, group: "System" },
];
