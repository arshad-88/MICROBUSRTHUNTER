import {
  Activity,
  Gauge,
  LayoutDashboard,
  Network,
  ScrollText,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  /** Primary navigation label. */
  label: string;
  /** Short code shown on the collapsed rail and used for the section index. */
  code: string;
  icon: LucideIcon;
  description: string;
}

/**
 * Navigation model. Routes are unchanged from the original console — only the
 * information architecture (labels, ordering, section numbering) is new.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    to: "/dashboard",
    label: "Overview",
    code: "01",
    icon: LayoutDashboard,
    description: "Fabric state, live traffic and burst intelligence at a glance",
  },
  {
    to: "/dashboard/topology",
    label: "Network Map",
    code: "02",
    icon: Network,
    description: "Interactive fabric: hosts, switch, uplink and per-flow state",
  },
  {
    to: "/dashboard/traffic",
    label: "Traffic Intelligence",
    code: "03",
    icon: Activity,
    description: "Rate, rolling baseline, burst threshold and detected intervals",
  },
  {
    to: "/dashboard/mitigation",
    label: "Mitigation",
    code: "04",
    icon: Gauge,
    description: "Detection to recovery: cap policy, verification and rollback",
  },
  {
    to: "/dashboard/events",
    label: "Event Timeline",
    code: "05",
    icon: ScrollText,
    description: "Audit trail of detections, policy changes and recovery",
  },
  {
    to: "/dashboard/settings",
    label: "Settings",
    code: "06",
    icon: Settings,
    description: "Detector, mitigation and simulation parameters",
  },
];

export function navItemForPath(pathname: string): NavItem {
  const exact = NAV_ITEMS.find((item) => item.to === pathname);
  if (exact) return exact;
  const nested = NAV_ITEMS.filter(
    (item) => item.to !== "/dashboard" && pathname.startsWith(item.to),
  ).sort((a, b) => b.to.length - a.to.length)[0];
  return nested ?? NAV_ITEMS[0];
}
