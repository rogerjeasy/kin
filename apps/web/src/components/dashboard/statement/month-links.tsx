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
                "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-[background-color,border-color,box-shadow] duration-300",
                month.period === current ? "border-primary bg-primary text-primary-foreground shadow-[0_0_0_3px_rgb(var(--glow-gold)/0.22),var(--shadow-sm)]" : "bg-card hover:border-gold/60 hover:bg-muted",
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
