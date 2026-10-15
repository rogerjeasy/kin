import { BadgeCheckIcon, LayoutDashboardIcon, ReceiptTextIcon, ScaleIcon, ScrollTextIcon, UsersIcon, type LucideIcon } from "lucide-react";

import type { DashboardSection } from "@/content/dashboard-routes";

export const sectionIcons: Record<DashboardSection, LucideIcon> = {
  overview: LayoutDashboardIcon,
  approvals: BadgeCheckIcon,
  bills: ReceiptTextIcon,
  fairness: ScaleIcon,
  record: ScrollTextIcon,
  circle: UsersIcon,
};
