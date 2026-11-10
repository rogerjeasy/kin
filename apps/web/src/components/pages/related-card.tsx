import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";

type RelatedCardProps = { href: string; eyebrow: string; title: string; link: string };

/** One of the other pages, as a lit card that is a link from edge to edge. */
export function RelatedCard({ href, eyebrow, title, link }: RelatedCardProps) {
  return (
    <li className="flex min-w-0">
      <Link href={href} className="group surface lift glow-edge flex min-w-0 flex-1 flex-col rounded-3xl p-6 sm:p-7">
        <span className="inline-flex items-center gap-2.5 text-sm font-medium text-muted-foreground uppercase ltr:tracking-widest">
          <span aria-hidden="true" className="h-px w-5 bg-gold" />
          {eyebrow}
        </span>
        <span className="mt-4 font-serif text-2xl text-balance">{title}</span>
        <span className="mt-auto inline-flex items-center gap-3 pt-8 font-medium">
          {link}
          <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full border border-input transition-colors duration-300 group-hover:border-gold group-hover:bg-gold/15">
            <ArrowRightIcon className="size-4 transition-transform duration-300 group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" />
          </span>
        </span>
      </Link>
    </li>
  );
}
