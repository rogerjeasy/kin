"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

type CopyIdButtonProps = { id: string; copy: { copyId: string; copied: string; copyFailed: string } };

type Outcome = "idle" | "copied" | "failed";

/** Copies an entry's ID, so it can be pasted into a message or a spreadsheet. Says in words that it did, or that it could not. */
export function CopyIdButton({ id, copy }: CopyIdButtonProps) {
  const [outcome, setOutcome] = useState<Outcome>("idle");

  useEffect(() => {
    if (outcome === "idle") return;
    const timer = setTimeout(() => setOutcome("idle"), 3_000);
    return () => clearTimeout(timer);
  }, [outcome]);

  async function copyId() {
    try {
      await navigator.clipboard.writeText(id);
      setOutcome("copied");
    } catch {
      // A browser may refuse the clipboard (no permission, an insecure page); the ID is on screen to select.
      setOutcome("failed");
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={copyId}>
        {outcome === "copied" ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
        {copy.copyId}
      </Button>
      <span role="status" className="text-sm text-muted-foreground">
        {outcome === "copied" ? copy.copied : outcome === "failed" ? copy.copyFailed : ""}
      </span>
    </span>
  );
}
