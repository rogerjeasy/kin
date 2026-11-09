import { ShieldQuestionIcon } from "lucide-react";

import { Panel } from "@/components/dashboard/ui/panel";
import type { Dictionary } from "@/i18n/dictionary";

type Props = { copy: Dictionary["dashboard"]["presence"]["link"]; href: string };

/** The overview's way into "Is it really you?": a caller says they are family and asks for money, so ask Kin to check with the real person. */
export function PresenceCard({ copy, href }: Props) {
  return (
    <Panel title={copy.title} description={copy.text} link={{ href, label: copy.label }} aside={<ShieldQuestionIcon aria-hidden="true" className="size-6 shrink-0 text-highlight" />}>
      <p className="sr-only">{copy.title}</p>
    </Panel>
  );
}
