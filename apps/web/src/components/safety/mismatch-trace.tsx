import { XIcon } from "lucide-react";

import { RecordLine } from "@/components/shared/record-line";
import { TraceSteps } from "@/components/shared/trace-steps";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

type MismatchTraceProps = {
  copy: Dictionary["safetyPage"]["guard"];
  trace: Dictionary["trace"];
  /** The amount as the record holds it, formatted. */
  amount: string;
};

/** The same record, worded with the wrong amount: the sentence never reaches Rose. */
export function MismatchTrace({ copy, trace, amount }: MismatchTraceProps) {
  return (
    <TraceSteps
      label={copy.mismatchTitle}
      steps={[
        { label: trace.recordLabel, body: <RecordLine amount={amount} biller={trace.biller} /> },
        {
          label: trace.checkLabel,
          body: (
            <>
              {fill(copy.mismatch, { spoken: copy.wrongAmount, amount })}{" "}
              <XIcon aria-hidden="true" className="inline size-5 align-text-bottom text-muted-foreground" />
            </>
          ),
        },
        { label: copy.fallbackLabel, body: copy.fallback },
      ]}
    />
  );
}
