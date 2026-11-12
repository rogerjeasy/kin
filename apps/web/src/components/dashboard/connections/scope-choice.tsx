"use client";

import type { DelegationScope } from "@kin/domain";

import type { Dictionary } from "@/i18n/dictionary";

type Props = {
  name: string;
  legend: string;
  scopes: Dictionary["openKin"]["grant"]["scopes"];
  value: DelegationScope;
  disabled: boolean;
  onChange: (scope: DelegationScope) => void;
};

/** What a member lets their assistant do: read, or read and propose. No choice approves. */
export function ScopeChoice({ name, legend, scopes, value, disabled, onChange }: Props) {
  return (
    <fieldset className="grid min-w-0 gap-2">
      <legend className="font-medium">{legend}</legend>
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        {(["read", "propose"] as const).map((each) => (
          <label key={each} className="flex min-h-11 min-w-0 cursor-pointer items-start gap-3 rounded-2xl border bg-background/70 p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring">
            <input type="radio" name={name} value={each} checked={value === each} disabled={disabled} onChange={() => onChange(each)} className="mt-1 size-4 shrink-0 accent-primary" />
            <span className="min-w-0">
              <span className="block font-semibold">{scopes[each].title}</span>
              <span className="block text-sm text-pretty text-muted-foreground">{scopes[each].text}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
