"use client";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { Button } from "@/components/ui/button";

type AmountPickerProps = {
  label: string;
  hint: string;
  presetsLabel: string;
  /** Quick amounts as plain decimals ("50.00"), with their formatted labels. */
  presets: readonly { value: string; label: string }[];
  value: string;
  /** The message to show when the amount was refused, or `null`. */
  error: string | null;
  onChange: (value: string) => void;
};

/** The top-up's amount: typed, or chosen from a few quick amounts. */
export function AmountPicker({ label, hint, presetsLabel, presets, value, error, onChange }: AmountPickerProps) {
  return (
    <>
      <Field id="top-up-amount" label={label} hint={hint}>
        <input
          id="top-up-amount"
          name="amount"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={error === null ? "top-up-amount-hint" : "top-up-amount-hint top-up-amount-error"}
          aria-invalid={error !== null}
          className={inputClass}
        />
      </Field>
      <div role="group" aria-label={presetsLabel} className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <Button
            key={preset.value}
            type="button"
            variant={preset.value === value ? "default" : "outline"}
            size="sm"
            className="min-h-11 min-w-16"
            aria-pressed={preset.value === value}
            onClick={() => onChange(preset.value)}
          >
            {preset.label}
          </Button>
        ))}
      </div>
      {error === null ? null : (
        <p id="top-up-amount-error" role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
