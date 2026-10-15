"use client";

import { useState } from "react";

import { StatusNote } from "@/components/shared/status-note";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import { cn } from "@/lib/utils";

export type DemoAction = { label: string; variant?: "default" | "outline" };

type DemoActionsProps = {
  actions: readonly DemoAction[];
  /** What every button answers in the demo: nothing moved. */
  note: Dictionary["dashboard"]["demoAction"];
  className?: string;
};

/**
 * The buttons that will move money or change the circle once accounts open.
 * In the demo each one answers, in plain words, that nothing moved. No request
 * is sent.
 */
export function DemoActions({ actions, note, className }: DemoActionsProps) {
  const [answered, setAnswered] = useState(false);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button key={action.label} type="button" size="sm" variant={action.variant ?? "default"} className="whitespace-normal" onClick={() => setAnswered(true)}>
            {action.label}
          </Button>
        ))}
      </div>
      <div role="status">{answered ? <StatusNote title={note.title} text={note.text} /> : null}</div>
    </div>
  );
}
