import { CircleCheckIcon } from "lucide-react";

import { SpokenLines } from "@/components/shared/spoken-lines";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

type ScamCheckProps = {
  copy: Dictionary["safetyPage"]["scam"];
  people: Dictionary["common"]["people"];
  /** The gas bill that was really paid, formatted. */
  paidAmount: string;
};

/** What Rose asked and what Kin answered, beside the facts the answer rests on. */
export function ScamCheck({ copy, people, paidAmount }: ScamCheckProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
      <div className="flex min-w-0 flex-col justify-center rounded-3xl border bg-card p-6 sm:p-9">
        <SpokenLines
          lines={[
            { speaker: people.rose, text: copy.roseLine, voice: "person" },
            { speaker: people.kin, text: copy.kinLine, voice: "kin" },
          ]}
        />
      </div>
      <div className="min-w-0 rounded-3xl bg-muted p-6 sm:p-9">
        <h3 className="text-sm font-medium text-muted-foreground uppercase ltr:tracking-widest">{copy.checkedTitle}</h3>
        <dl className="mt-2 divide-y">
          {copy.checked.map((item) => (
            <div key={item.question} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 py-4">
              <CircleCheckIcon aria-hidden="true" className="mt-0.5 size-5 text-highlight" />
              <div className="min-w-0">
                <dt className="text-muted-foreground">{item.question}</dt>
                <dd className="mt-0.5 text-lg font-semibold">{fill(item.answer, { amount: paidAmount })}</dd>
              </div>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-muted-foreground">{copy.note}</p>
      </div>
    </div>
  );
}
