import type { ReactNode } from "react";

type FieldProps = { id: string; label: string; hint?: string; children: ReactNode };

/** A labelled form field, with its hint tied to the control for screen readers. */
export function Field({ id, label, hint, children }: FieldProps) {
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const inputClass =
  "min-h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3.5 text-base shadow-[inset_0_1px_2px_var(--shadow-tint-1)] transition-[border-color,box-shadow,background-color] duration-300 ease-(--ease-out-expo) placeholder:text-muted-foreground hover:border-foreground/30 focus-visible:border-ring focus-visible:bg-card focus-visible:shadow-[0_0_0_4px_rgb(var(--glow-gold)/0.18)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-muted";
