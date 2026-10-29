"use client";

import { bpsFromPercent } from "@kin/domain";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

type Props = {
  copy: Dictionary["dashboard"]["agreement"]["form"];
  members: readonly { id: string; name: string }[];
  shares: Readonly<Record<string, string>>;
  onChange: (memberId: string, percent: string) => void;
};

/** One share per member who shares the cost, with the running total for quick feedback. */
export function ShareFields({ copy, members, shares, onChange }: Props) {
  // Feedback only: the server reads every share again, digit by digit.
  const total = members.reduce((sum, member) => {
    try {
      return sum + bpsFromPercent(shares[member.id] ?? "");
    } catch {
      return sum;
    }
  }, 0);
  return (
    <fieldset className="min-w-0 space-y-4">
      <legend className="font-semibold">{copy.sharesLegend}</legend>
      <p className="text-sm text-muted-foreground">{copy.sharesHint}</p>
      {members.length === 0 ? <p className="text-sm">{copy.noSharers}</p> : null}
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        {members.map((member) => (
          <Field key={member.id} id={`share-${member.id}`} label={fill(copy.shareLabel, { name: member.name })}>
            <input id={`share-${member.id}`} type="text" inputMode="decimal" maxLength={6} value={shares[member.id] ?? ""} onChange={(event) => onChange(member.id, event.target.value)} className={inputClass} />
          </Field>
        ))}
      </div>
      <p role="status" className={`text-sm font-medium tabular-nums ${total === 10_000 ? "text-positive" : "text-muted-foreground"}`}>
        {fill(copy.total, { total: (total / 100).toString() })}
      </p>
    </fieldset>
  );
}
