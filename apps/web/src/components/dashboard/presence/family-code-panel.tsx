import { KeyRoundIcon } from "lucide-react";

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
    <Panel title={copy.title} description={copy.text} aside={<KeyRoundIcon aria-hidden="true" className="size-6 shrink-0 text-highlight" />}>
      <p dir="ltr" lang="en" className="text-3xl font-semibold tracking-wide wrap-anywhere sm:text-4xl">
        {code.words.join(" · ")}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{fill(copy.week, { week: code.week })}</p>
    </Panel>
  );
}
