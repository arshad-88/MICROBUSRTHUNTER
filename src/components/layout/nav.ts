import {
  Activity,
  FlaskConical,
  LayoutDashboard,
  Network,
  ScrollText,
  Settings,
  Share2,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    to: "/dashboard",
    label: "Overview",
    icon: LayoutDashboard,
    description: "Live KPIs, burst status and mitigation state",
  },
  {
    to: "/dashboard/topology",
    label: "Network Topology",
    icon: Network,
    description: "Interactive fabric with per-node and per-link detail",
  },
  {
    to: "/dashboard/traffic",
    label: "Traffic Monitor",
    icon: Activity,
    description: "Rate, baseline, threshold and burst intervals",
  },
  {
    to: "/dashboard/sources",
    label: "Source Analysis",
    icon: Share2,
    description: "Per-source contributions and rankings",
  },
  {
    to: "/dashboard/mitigation",
    label: "Mitigation",
    icon: ShieldCheck,
    description: "Adaptive policy, caps and recovery",
  },
  {
    to: "/dashboard/experiments",
    label: "Experiments",
    icon: FlaskConical,
    description: "Three reproducible scenarios and comparison",
  },
  {
    to: "/dashboard/events",
    label: "Event Logs",
    icon: ScrollText,
    description: "Audit trail with filters and CSV export",
  },
  {
    to: "/dashboard/settings",
    label: "Settings",
    icon: Settings,
    description: "Detection, mitigation and simulation parameters",
  },
];
