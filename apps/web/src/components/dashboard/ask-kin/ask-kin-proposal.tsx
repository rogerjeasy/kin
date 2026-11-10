import { ArrowRightIcon, HourglassIcon } from "lucide-react";
import Link from "next/link";

import type { Dictionary } from "@/i18n/dictionary";

type Props = { href: string; copy: Dictionary["askKin"]["proposal"] };

/** A refill Kin proposed while answering. It waits for the family; Kin cannot approve or pay it. */
export function AskKinProposal({ href, copy }: Props) {
  return (
    <section aria-label={copy.title} className="min-w-0 rounded-2xl border border-gold/50 bg-highlight/10 p-4 shadow-[0_0_28px_-10px_rgb(var(--glow-gold)/0.7)] motion-safe:animate-scale-in">
      <h3 className="flex items-center gap-2.5 font-semibold">
        <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-gold/20 text-highlight ring-1 ring-gold/40">
          <HourglassIcon className="size-4 motion-safe:animate-spin-slow" />
        </span>
        {copy.title}
      </h3>
      <p className="mt-2 text-sm">{copy.text}</p>
      <Link href={href} className="group mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-highlight">
        {copy.link}
        <ArrowRightIcon aria-hidden="true" className="size-4 transition-transform duration-300 group-hover:translate-x-1 rtl:-scale-x-100" />
      </Link>
    </section>
  );
}
