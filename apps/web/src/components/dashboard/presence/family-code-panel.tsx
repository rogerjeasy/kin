import { KeyRoundIcon } from "lucide-react";
import { Fragment } from "react";

import { Panel } from "@/components/dashboard/ui/panel";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { FamilyCode } from "@kin/telephony";

type Props = { code: FamilyCode; copy: Dictionary["dashboard"]["presence"]["code"] };

/**
 * This week's three words, large and plain, for those who may know them. They change every Monday on the circle's own
 * clock. The words are English in every language: they are said aloud and typed, and a caller who cannot say them is the point.
 */
export function FamilyCodePanel({ code, copy }: Props) {
  return (
    <Panel title={copy.title} description={copy.text} aside={<span aria-hidden="true" className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-gold/15 text-highlight ring-1 ring-gold/40 shadow-[0_0_20px_-6px_rgb(var(--glow-gold)/0.8)]"><KeyRoundIcon className="size-5" /></span>}>
      <p dir="ltr" lang="en" className="enter-stagger flex min-w-0 flex-wrap items-center gap-x-2 gap-y-3">
        {code.words.map((word, index) => (
          <Fragment key={`${word}-${index}`}>
            {index > 0 ? <span className="text-2xl text-highlight">{" · "}</span> : null}
            <span className="min-w-0 rounded-2xl bg-band px-4 py-2 font-serif text-3xl tracking-wide text-band-foreground shadow-[0_0_0_1px_var(--band-border),0_14px_34px_-14px_rgb(var(--glow-gold)/0.7)] wrap-anywhere sm:text-4xl">
              {word}
            </span>
          </Fragment>
        ))}
      </p>
      <p className="mt-4 text-sm text-muted-foreground">{fill(copy.week, { week: code.week })}</p>
    </Panel>
  );
}
