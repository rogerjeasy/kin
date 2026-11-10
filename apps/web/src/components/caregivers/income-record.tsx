import { CheckIcon } from "lucide-react";

import amara from "@/assets/images/amara.jpg";
import { Avatar } from "@/components/shared/avatar";
import { Tag } from "@/components/shared/tag";
import type { Dictionary } from "@/i18n/dictionary";

type IncomeRecordProps = {
  copy: Dictionary["caregiversPage"]["record"];
  /** One week's pay, formatted. */
  amount: string;
  /** Marks the card as example data. */
  tag: string;
};

/** A caregiver's record as she would see it: each week billed, and each week paid. */
export function IncomeRecord({ copy, amount, tag }: IncomeRecordProps) {
  return (
    <div className="surface glow-edge rounded-3xl p-6 shadow-lg sm:p-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Avatar src={amara} className="ring-2 ring-gold/50 ring-offset-2 ring-offset-card" />
        <h3 className="min-w-0 flex-1 basis-40 font-serif text-2xl">{copy.cardTitle}</h3>
        <Tag>{tag}</Tag>
      </div>
      <ul className="mt-6 space-y-2">
        {copy.weeks.map((week) => (
          <li key={week} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 rounded-2xl border bg-background/60 px-4 py-3.5 transition-colors duration-300 hover:border-gold/50">
            <p className="min-w-0">
              <strong className="block font-semibold">{week}</strong>
              <span className="text-sm text-muted-foreground">{copy.visits}</span>
            </p>
            <p className="text-end">
              <span className="block font-serif text-xl tabular-nums">{amount}</span>
              <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <span aria-hidden="true" className="grid size-4.5 place-items-center rounded-full bg-positive/15">
                  <CheckIcon className="size-3 text-positive" />
                </span>
                {copy.paid}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
