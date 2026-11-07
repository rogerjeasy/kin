import Link from "next/link";

import { cn } from "@/lib/utils";

type MonthLinksProps = {
  label: string;
  current: string;
  months: readonly { period: string; label: string; href: string }[];
};

/** The months a statement exists for, as links. The one on screen is marked as current. */
export function MonthLinks({ label, current, months }: MonthLinksProps) {
  return (
    <nav aria-label={label} className="print:hidden">
      <ul className="flex flex-wrap gap-2">
        {months.map((month) => (
          <li key={month.period}>
            <Link
              href={month.href}
              aria-current={month.period === current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium",
                month.period === current ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
              )}
            >
              {month.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
