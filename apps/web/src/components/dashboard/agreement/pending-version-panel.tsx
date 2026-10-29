import type { ReactNode } from "react";

import { Panel } from "@/components/dashboard/ui/panel";
import { StatusPill, type PillTone } from "@/components/dashboard/ui/status-pill";

import { AcceptanceList, type AcceptanceItem } from "./acceptance-list";
import { ChangeList } from "./change-list";

type Props = {
  title: string;
  text: string;
  status: { readonly text: string; readonly tone: PillTone };
  changesTitle: string;
  noChanges: string;
  changes: readonly string[];
  acceptedTitle: string;
  acceptances: readonly AcceptanceItem[];
  /** The viewer's Accept button, or a line saying they already did. */
  action: ReactNode;
};

/** A newer version than the one in force: what it changes, and who still has to accept it. */
export function PendingVersionPanel({ title, text, status, changesTitle, noChanges, changes, acceptedTitle, acceptances, action }: Props) {
  return (
    <Panel title={title} description={text} aside={<StatusPill tone={status.tone}>{status.text}</StatusPill>}>
      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <ChangeList title={changesTitle} empty={noChanges} changes={changes} />
        <div className="min-w-0 space-y-4">
          <AcceptanceList title={acceptedTitle} items={acceptances} />
          {action}
        </div>
      </div>
    </Panel>
  );
}
