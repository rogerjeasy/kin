"use client";

import { PauseIcon, PlayIcon } from "lucide-react";
import { useId, useState } from "react";

import { inputClass } from "@/components/dashboard/create-circle/field";
import { Panel } from "@/components/dashboard/ui/panel";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import { cn } from "@/lib/utils";

import { PurseError } from "./purse-error";
import { usePurseRequest } from "./use-purse-request";

type Copy = Dictionary["dashboard"]["purse"];
type Props = {
  copy: Copy;
  parentName: string;
  /** The terms in force, as decimals for the inputs, or `null` before the Purse is set up. */
  current: { readonly weekly: string; readonly ceiling: string; readonly cap: string } | null;
  status: "active" | "paused" | "revoked" | null;
  canSetUp: boolean;
  canStop: boolean;
};

/**
 * The family's decision: what moves into the Purse each week, the most it may
 * hold and the most one payment may be before Kin waits a day. The organizer
 * sets it; anyone who answers for the family, or she herself, may pause it.
 */
export function PurseSetup({ copy, parentName, current, status, canSetUp, canStop }: Props) {
  const id = useId();
  const { send, pending, error } = usePurseRequest();
  const [weekly, setWeekly] = useState(current?.weekly ?? "");
  const [ceiling, setCeiling] = useState(current?.ceiling ?? "");
  const [cap, setCap] = useState(current?.cap ?? "");
  const [saved, setSaved] = useState(false);
  const { setup } = copy;
  const fields = [
    { key: "weekly", label: setup.weekly, value: weekly, set: setWeekly },
    { key: "ceiling", label: setup.ceiling, value: ceiling, set: setCeiling },
    { key: "cap", label: setup.cap, value: cap, set: setCap },
  ] as const;

  async function save() {
    setSaved(false);
    const reply = await send({ operation: "setup", weekly, ceiling, cap });
    if (reply.ok) setSaved(true);
  }

  return (
    <Panel title={current === null ? setup.titleNew : setup.title} description={fill(setup.text, { parent: parentName })}>
      <div className="min-w-0 space-y-5">
        {canSetUp ? (
          <form
            className="min-w-0 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              {fields.map((field) => (
                <div key={field.key} className="grid min-w-0 gap-1.5">
                  <label htmlFor={`${id}-${field.key}`} className="font-medium">{field.label}</label>
                  <input id={`${id}-${field.key}`} inputMode="decimal" required maxLength={12} value={field.value} onChange={(event) => field.set(event.target.value)} aria-describedby={`${id}-hint`} className={cn(inputClass, "min-h-12 font-serif text-xl tabular-nums")} />
                </div>
              ))}
            </div>
            <p id={`${id}-hint`} className="text-sm text-muted-foreground">{setup.hint}</p>
            <Button type="submit" disabled={pending} className="h-auto max-w-full whitespace-normal">
              {setup.submit}
            </Button>
            {saved ? <p role="status" className="text-sm text-positive">{setup.saved}</p> : null}
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">{setup.readOnly}</p>
        )}
        {status === "active" && canStop ? (
          <Button type="button" variant="outline" disabled={pending} onClick={() => void send({ operation: "status", status: "paused" })} className="h-auto max-w-full whitespace-normal">
            <PauseIcon aria-hidden="true" />
            {setup.pause}
          </Button>
        ) : null}
        {status === "paused" && canSetUp ? (
          <Button type="button" variant="outline" disabled={pending} onClick={() => void send({ operation: "status", status: "active" })} className="h-auto max-w-full whitespace-normal">
            <PlayIcon aria-hidden="true" />
            {setup.resume}
          </Button>
        ) : null}
        <PurseError copy={copy.errors} error={error} money={() => ""} />
      </div>
    </Panel>
  );
}
