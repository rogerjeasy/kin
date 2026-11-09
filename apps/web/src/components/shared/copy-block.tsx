"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type Props = { label: string; value: string; copyLabel: string; copiedLabel: string; failedLabel: string };

/** A block of code or configuration, wrapped to its container, with a button that copies it. */
export function CopyBlock({ label, value, copyLabel, copiedLabel, failedLabel }: Props) {
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
    <figure className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <figcaption className="text-sm font-semibold">{label}</figcaption>
        <Button type="button" variant="ghost" size="sm" onClick={() => void copy()} aria-label={`${copyLabel}: ${label}`}>
          {state === "copied" ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          {state === "copied" ? copiedLabel : copyLabel}
        </Button>
      </div>
      {/* Code reads left to right in every language, and wraps rather than pushing the page sideways. */}
      <pre dir="ltr" className="mt-1 min-w-0 rounded-lg bg-secondary p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere">
        {value}
      </pre>
      {state === "failed" ? <p role="status" className="mt-1 text-sm text-muted-foreground">{failedLabel}</p> : null}
    </figure>
  );
}
