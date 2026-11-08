import { BadgeCheckIcon, CalendarDaysIcon, LayoutDashboardIcon, ReceiptTextIcon, ScaleIcon, ScrollTextIcon, UsersIcon, type LucideIcon } from "lucide-react";

import type { DashboardSection } from "@/content/dashboard-routes";

export const sectionIcons: Record<DashboardSection, LucideIcon> = {
  overview: LayoutDashboardIcon,
  shifts: CalendarDaysIcon,
  approvals: BadgeCheckIcon,
  bills: ReceiptTextIcon,
  fairness: ScaleIcon,
  record: ScrollTextIcon,
  circle: UsersIcon,
};
