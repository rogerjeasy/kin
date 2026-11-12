import { PlugZapIcon } from "lucide-react";

import { FeatureTile } from "@/components/dashboard/ui/feature-tile";
import { Panel } from "@/components/dashboard/ui/panel";
import type { Dictionary } from "@/i18n/dictionary";

type Props = {
  copy: Dictionary["openKin"]["card"];
  boundary: Dictionary["openKin"]["boundary"];
  href: string;
  /** A small tile among the overview's helpers; a full panel on the circle's page. */
  tile?: boolean;
};

/** The way into Connected assistants, from the overview and the circle's page: the boundary in one line, and the link. */
export function ConnectionsCard({ copy, boundary, href, tile = false }: Props) {
  const line = (
    <p className="text-sm text-muted-foreground">
      {boundary.read.title} · {boundary.propose.title} · <strong className="font-semibold text-foreground">{boundary.never.title}</strong>
    </p>
  );
  const link = { href, label: copy.open };
  if (tile) {
    return (
      <FeatureTile title={copy.title} text={copy.text} link={link} icon={PlugZapIcon}>
        {line}
      </FeatureTile>
    );
  }
  return (
    <Panel title={copy.title} description={copy.text} link={link} aside={<PlugZapIcon aria-hidden="true" className="size-6 shrink-0 text-highlight" />}>
      {line}
    </Panel>
  );
}
