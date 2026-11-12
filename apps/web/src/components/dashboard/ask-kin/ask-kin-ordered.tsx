import { ArrowRightIcon, BadgeCheckIcon } from "lucide-react";
import Link from "next/link";

import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { AskKinRaised } from "@/server/ask-kin/ask-kin";

type Props = {
  raised: Extract<AskKinRaised, { kind: "standing_permission" }>;
  copy: Dictionary["askKin"]["orderedProposal"];
};

/**
 * A refill the parent's standing permission approved at once, so nobody is
 * asked and the order is placed. It says who approved it, because Kin did not.
 */
export function AskKinOrdered({ raised, copy }: Props) {
  const title = fill(copy.title, { parent: raised.words.parent });
  return (
    <section aria-label={title} className="min-w-0 rounded-2xl border border-positive/40 bg-positive/10 p-4 motion-safe:animate-scale-in">
      <h3 className="flex flex-wrap items-center gap-x-2.5 gap-y-2 font-semibold">
        <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-positive/15 text-positive ring-1 ring-positive/30">
          <BadgeCheckIcon className="size-4" />
        </span>
        <span className="min-w-0 text-pretty">{title}</span>
      </h3>
      <p className="mt-2 text-sm text-pretty">{fill(copy.text, raised.words)}</p>
      <Link href={raised.href} className="group mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-highlight">
        {copy.link}
        <ArrowRightIcon aria-hidden="true" className="size-4 transition-transform duration-300 group-hover:translate-x-1 rtl:-scale-x-100" />
      </Link>
    </section>
  );
}
