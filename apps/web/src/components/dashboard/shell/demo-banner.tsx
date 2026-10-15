import { FlaskConicalIcon } from "lucide-react";

import type { Dictionary } from "@/i18n/dictionary";

type DemoBannerProps = { copy: Dictionary["dashboard"]["shell"]["demo"] };

/**
 * Says on every screen that the circle is a demonstration. Simulated money is
 * always labelled as simulated (AGENTS.md section 5, rule 9), so this cannot
 * be dismissed.
 */
export function DemoBanner({ copy }: DemoBannerProps) {
  return (
    <div role="note" className="flex items-start gap-3 rounded-xl border border-highlight/25 bg-highlight/8 px-4 py-3 text-sm">
      <FlaskConicalIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-highlight" />
      <p className="min-w-0">
        <strong className="font-semibold">{copy.label}.</strong> <span className="text-muted-foreground">{copy.text}</span>
      </p>
    </div>
  );
}
