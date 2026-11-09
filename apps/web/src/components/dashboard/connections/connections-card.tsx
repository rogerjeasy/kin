import { PlugZapIcon } from "lucide-react";

import { Panel } from "@/components/dashboard/ui/panel";
import type { Dictionary } from "@/i18n/dictionary";

type Props = { copy: Dictionary["openKin"]["card"]; boundary: Dictionary["openKin"]["boundary"]; href: string };

/** The way into Connected assistants, from the overview and the circle's page: the boundary in one line, and the link. */
export function ConnectionsCard({ copy, boundary, href }: Props) {
  return (
    <Panel title={copy.title} description={copy.text} link={{ href, label: copy.open }} aside={<PlugZapIcon aria-hidden="true" className="size-6 shrink-0 text-highlight" />}>
      <p className="text-sm text-muted-foreground">
        {boundary.read.title} · {boundary.propose.title} · <strong className="font-semibold text-foreground">{boundary.never.title}</strong>
      </p>
    </Panel>
  );
}
