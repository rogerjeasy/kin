import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";

type RelatedCardProps = { href: string; eyebrow: string; title: string; link: string };

/** One of the other pages, as a card that is a link from edge to edge. */
export function RelatedCard({ href, eyebrow, title, link }: RelatedCardProps) {
  return (
    <li className="flex min-w-0">
      <Link href={href} className="group flex min-w-0 flex-1 flex-col rounded-3xl border bg-card p-6 transition-colors hover:border-input hover:bg-accent sm:p-7">
        <span className="text-sm font-medium text-muted-foreground uppercase ltr:tracking-widest">{eyebrow}</span>
        <span className="mt-3 font-serif text-2xl text-balance">{title}</span>
        <span className="mt-auto inline-flex items-center gap-2 pt-6 font-medium">
          {link}
          <ArrowRightIcon aria-hidden="true" className="size-4 shrink-0 transition-transform group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1" />
        </span>
      </Link>
    </li>
  );
}
