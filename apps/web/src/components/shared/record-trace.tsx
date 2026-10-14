import { CheckIcon } from "lucide-react";

import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

import { RecordLine } from "./record-line";
import { TraceSteps } from "./trace-steps";

type RecordTraceProps = {
  copy: Dictionary["trace"];
  /** The amount as Kin says it, for example "84 dollars". */
  spoken: string;
  /** The same amount as the record holds it, formatted. */
  amount: string;
};

/** The three steps between a PayPal record and a sentence Rose hears. */
export function RecordTrace({ copy, spoken, amount }: RecordTraceProps) {
  return (
    <TraceSteps
      label={copy.label}
      steps={[
        { label: copy.recordLabel, body: <RecordLine amount={amount} biller={copy.biller} /> },
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
      ]}
    />
  );
}
