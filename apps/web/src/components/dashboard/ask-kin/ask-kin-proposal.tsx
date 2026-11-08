import { ArrowRightIcon, HourglassIcon } from "lucide-react";
import Link from "next/link";

import type { Dictionary } from "@/i18n/dictionary";

type Props = { href: string; copy: Dictionary["askKin"]["proposal"] };

/** A refill Kin proposed while answering. It waits for the family; Kin cannot approve or pay it. */
export function AskKinProposal({ href, copy }: Props) {
  return (
    <section aria-label={copy.title} className="min-w-0 rounded-xl border border-highlight/40 bg-highlight/5 p-4">
      <h3 className="flex items-center gap-2 font-semibold">
        <HourglassIcon aria-hidden="true" className="size-4 shrink-0 text-highlight" />
        {copy.title}
      </h3>
      <p className="mt-1 text-sm">{copy.text}</p>
      <Link href={href} className="group mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold">
        {copy.link}
        <ArrowRightIcon aria-hidden="true" className="size-4 rtl:-scale-x-100" />
      </Link>
    </section>
  );
}
