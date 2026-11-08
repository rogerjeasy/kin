"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

import { inputClass } from "@/components/dashboard/create-circle/field";
import { Button } from "@/components/ui/button";

type Props = { label: string; value: string; copyLabel: string; copiedLabel: string; failedLabel: string };

/** A read-only line with a button that copies it. If the browser will not copy, the line is selected and the person is told to. */
export function CopyField({ label, value, copyLabel, copiedLabel, failedLabel }: Props) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="min-w-0 space-y-2">
      <label className="block text-sm font-medium">
        {label}
        {/* An address always reads left to right, in every language. */}
        <input readOnly dir="ltr" value={value} onFocus={(event) => event.currentTarget.select()} className={`${inputClass} mt-1.5 font-mono text-sm`} />
      </label>
      <Button type="button" variant="outline" size="sm" onClick={copy} className="w-full sm:w-auto">
        {state === "copied" ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
        {state === "copied" ? copiedLabel : copyLabel}
      </Button>
      {state === "failed" ? <p role="status" className="text-sm text-muted-foreground">{failedLabel}</p> : null}
    </div>
  );
}
