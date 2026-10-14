import { CheckIcon } from "lucide-react";

import { PAYOUT_EVENT } from "@/content/example-family";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

type RecordTraceProps = {
  copy: Dictionary["trace"];
  /** The amount as Kin says it, for example "84 dollars". */
  spoken: string;
  /** The same amount as the record holds it, formatted. */
  amount: string;
};

/** The three steps between a PayPal record and a sentence Rose hears. */
export function RecordTrace({ copy, spoken, amount }: RecordTraceProps) {
  const steps = [
    {
      label: copy.recordLabel,
      body: (
        <>
          {/* PayPal's own event name. It is the same in every language. */}
          <code dir="ltr" className="block font-mono text-sm break-all">{PAYOUT_EVENT}</code>
          <span className="block font-mono text-sm">
            {amount} · {copy.biller}
          </span>
        </>
      ),
    },
    {
      label: copy.checkLabel,
      body: (
        <>
          {fill(copy.check, { spoken, amount })}{" "}
          <CheckIcon aria-hidden="true" className="inline size-5 align-text-bottom text-highlight" />
        </>
      ),
    },
    { label: copy.thenLabel, body: copy.then },
  ];

  return (
    <ol aria-label={copy.label} className="grid divide-y rounded-2xl border bg-card md:grid-cols-3 md:divide-x md:divide-y-0">
      {steps.map((step) => (
        <li key={step.label} className="min-w-0 px-6 py-5">
          <p className="text-xs font-medium text-muted-foreground uppercase ltr:tracking-wider">{step.label}</p>
          <div className="mt-2">{step.body}</div>
        </li>
      ))}
    </ol>
  );
}
