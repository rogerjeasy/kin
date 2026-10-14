import Image, { type StaticImageData } from "next/image";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type TimelineEntryProps = {
  day: string;
  title: string;
  text: string;
  photo?: { src: StaticImageData; alt: string };
  /** The last entry ends the line that joins the days. */
  isLast: boolean;
  /** What follows the words: a quote, the shares, who approved. */
  children: ReactNode;
};

/**
 * One day of the month. On a phone the day sits above the words, beside the
 * line, and the photograph comes before them. From md up the day moves to its
 * own column on the far side of the line, and from lg up the photograph stands
 * beside the words.
 */
export function TimelineEntry({ day, title, text, photo, isLast, children }: TimelineEntryProps) {
  return (
    <li className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-x-5 md:grid-cols-[6rem_0.75rem_minmax(0,1fr)] md:gap-x-7">
      <p className="col-start-2 row-start-1 font-mono text-sm font-medium text-highlight uppercase md:col-start-1 md:text-end ltr:tracking-widest">
        {day}
      </p>
      <div aria-hidden="true" className="col-start-1 row-span-2 row-start-1 flex flex-col items-center md:col-start-2 md:row-span-1">
        <span className="mt-1 size-3 shrink-0 rounded-full bg-highlight" />
        {isLast ? null : <span className="mt-2 w-px flex-1 bg-border" />}
      </div>
      <div className={cn("col-start-2 row-start-2 grid min-w-0 items-start gap-x-12 gap-y-6 pt-2 md:col-start-3 md:row-start-1 md:pt-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]", isLast ? "pb-2" : "pb-14 lg:pb-20")}>
        <div className="min-w-0 max-w-2xl">
          <h3 className="font-serif text-subtitle">{title}</h3>
          <p className="mt-3 text-lg text-muted-foreground">{text}</p>
          {children}
        </div>
        {photo ? (
          <Image
            src={photo.src}
            alt={photo.alt}
            sizes="(min-width: 1024px) 20rem, (min-width: 768px) 28rem, 100vw"
            className="order-first aspect-4/3 w-full max-w-md min-w-0 rounded-2xl object-cover lg:order-last"
          />
        ) : null}
      </div>
    </li>
  );
}
