import { FlaskConicalIcon } from "lucide-react";

import { StatusPill } from "@/components/dashboard/ui/status-pill";

import type { AssistantCopy } from "./care-calendar-types.ts";

/**
 * What the assistant is, in the words around it: marked experimental, and
 * saying plainly that it only answers and highlights. The widget's own chat
 * button opens it.
 */
export function CareCalendarAssistantNote({ copy }: { readonly copy: AssistantCopy }) {
  return (
    <div className="min-w-0 space-y-1 px-2 pb-2 text-sm">
      <p className="flex min-w-0 flex-wrap items-center gap-2">
        <StatusPill tone="neutral" icon={FlaskConicalIcon}>{copy.experimental}</StatusPill>
        <span className="min-w-0 font-semibold">{copy.title}</span>
      </p>
      <p className="max-w-3xl text-pretty text-muted-foreground">{copy.note}</p>
      <p className="max-w-3xl text-pretty text-muted-foreground">{copy.examples}</p>
    </div>
  );
}
