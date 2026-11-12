import { ArrowRightIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { IconTile } from "./icon-tile";

type FeatureTileProps = {
  title: string;
  text: string;
  icon: LucideIcon;
  /** Green for something Kin already caught; the house highlight otherwise. */
  tone?: "positive" | "highlight";
  /** The screen that holds the rest. */
  link?: { href: string; label: string };
  /** One short line of what is happening now, when there is one. */
  children?: ReactNode;
};

/** A small titled tile for one of Kin's helpers, in the overview's grid of them: icon, a line or two, and the way in. */
export function FeatureTile({ title, text, icon, tone = "highlight", link, children }: FeatureTileProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="surface reveal flex min-w-0 flex-col gap-3 rounded-2xl p-4 sm:p-5">
      <div className="flex min-w-0 items-start gap-3">
        <IconTile icon={icon} className={cn("rounded-xl", tone === "positive" ? "bg-positive/10 text-positive" : "text-highlight")} />
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="font-semibold tracking-tight text-balance break-words">
            {title}
          </h3>
          <p className="mt-1 text-sm text-pretty text-muted-foreground">{text}</p>
        </div>
      </div>
      {children ? <div className="min-w-0 text-sm text-pretty break-words">{children}</div> : null}
      {link ? (
        <Link href={link.href} className="group mt-auto inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold">
          {link.label}
          <ArrowRightIcon aria-hidden="true" className="size-4 transition-transform duration-300 group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1" />
        </Link>
      ) : null}
    </section>
  );
}
