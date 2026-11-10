import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type PanelProps = {
  title: string;
  description?: string;
  /** A link to the screen that holds the rest. */
  link?: { href: string; label: string };
  /** Something beside the title, such as a count or a status. */
  aside?: ReactNode;
  /** Set when the body brings its own padding, such as a full-width list. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
};

/** A titled card that holds one region of a screen. */
export function Panel({ title, description, link, aside, flush = false, className, children }: PanelProps) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className={cn("surface reveal flex min-w-0 flex-col rounded-3xl", className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5 sm:px-6">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-lg font-semibold tracking-tight text-balance">
            {title}
          </h2>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {aside}
      </header>
      <div className={cn("flex-1", flush ? "mt-4" : "px-5 pt-4 pb-5 sm:px-6 sm:pb-6")}>{children}</div>
      {link ? (
        <footer className="border-t border-dashed px-5 sm:px-6">
          <Link href={link.href} className="group inline-flex min-h-12 items-center gap-2 text-sm font-semibold">
            {link.label}
            <span aria-hidden="true" className="inline-flex size-6 items-center justify-center rounded-full bg-secondary transition-[background-color,color,transform] duration-300 group-hover:translate-x-1 group-hover:bg-primary group-hover:text-primary-foreground rtl:-scale-x-100 rtl:group-hover:-translate-x-1">
              <ArrowRightIcon className="size-3.5" />
            </span>
          </Link>
        </footer>
      ) : null}
    </section>
  );
}
