import { BadgeCheckIcon, CalendarDaysIcon, LayoutDashboardIcon, ReceiptTextIcon, ScaleIcon, ScrollTextIcon, UsersIcon, Volume2Icon, type LucideIcon } from "lucide-react";

import type { DashboardSection } from "@/content/dashboard-routes";

export const sectionIcons: Record<DashboardSection, LucideIcon> = {
  overview: LayoutDashboardIcon,
  shifts: CalendarDaysIcon,
  approvals: BadgeCheckIcon,
  bills: ReceiptTextIcon,
  fairness: ScaleIcon,
  record: ScrollTextIcon,
  listen: Volume2Icon,
  circle: UsersIcon,
};
