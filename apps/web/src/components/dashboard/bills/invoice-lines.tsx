import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";

import type { InvoiceLineView } from "@/content/open-kin/invoice-views";
import type { Dictionary } from "@/i18n/dictionary";

type Props = { lines: readonly InvoiceLineView[]; copy: Dictionary["dashboard"]["bills"]["invoices"] };

/** The visits an agency charges for, each with what Kin's own calendar says about it. */
export function InvoiceLines({ lines, copy }: Props) {
  return (
    <ul className="grid min-w-0 gap-2" aria-label={copy.lines}>
      {lines.map((line) => (
        <li key={line.position} className="grid min-w-0 gap-1 rounded-xl border bg-background/70 p-3 text-sm">
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="min-w-0 flex-1 basis-48 font-medium wrap-anywhere">{line.visit}</p>
            <p className="tabular-nums">
              <span className="text-muted-foreground">{line.minutes}</span> · <span className="font-semibold">{line.amount}</span>
            </p>
          </div>
          {line.flags.length === 0 ? (
            <p className="flex min-w-0 items-start gap-2 text-positive">
              <CircleCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0">{copy.matches}</span>
            </p>
          ) : (
            line.flags.map((flag) => (
              <p key={flag} className="flex min-w-0 items-start gap-2 text-danger">
                <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0">{copy.flags[flag]}</span>
              </p>
            ))
          )}
        </li>
      ))}
    </ul>
  );
}
