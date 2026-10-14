import { RecordTrace } from "@/components/shared/record-trace";
import { Tag } from "@/components/shared/tag";
import type { Dictionary } from "@/i18n/dictionary";

import { MismatchTrace } from "./mismatch-trace";

type GuardDemoProps = {
  copy: Dictionary["safetyPage"]["guard"];
  trace: Dictionary["trace"];
  /** The amount as Kin says it, for example "84 dollars". */
  spoken: string;
  /** The same amount as the record holds it, formatted. */
  amount: string;
};

/** The number check at work twice: once on a faithful sentence, once on a wrong one. */
export function GuardDemo({ copy, trace, spoken, amount }: GuardDemoProps) {
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm font-medium text-muted-foreground">{copy.checksLabel}</p>
        <ul className="flex flex-wrap gap-2">
          {copy.checks.map((check) => (
            <li key={check} className="flex">
              <Tag>{check}</Tag>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-lg font-semibold">{copy.matchTitle}</h3>
        <div className="mt-3">
          <RecordTrace copy={trace} spoken={spoken} amount={amount} />
        </div>
      </div>
      <div>
        <h3 className="text-lg font-semibold">{copy.mismatchTitle}</h3>
        <div className="mt-3">
          <MismatchTrace copy={copy} trace={trace} amount={amount} />
        </div>
      </div>
    </div>
  );
}
