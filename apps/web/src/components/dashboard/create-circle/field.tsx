import type { ReactNode } from "react";

type FieldProps = { id: string; label: string; hint?: string; children: ReactNode };

/** A labelled form field, with its hint tied to the control for screen readers. */
export function Field({ id, label, hint, children }: FieldProps) {
  return (
    <div className="grid gap-1.5">
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
  "min-h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
