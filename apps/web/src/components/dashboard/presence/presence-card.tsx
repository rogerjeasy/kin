import { ShieldQuestionIcon } from "lucide-react";

import { FeatureTile } from "@/components/dashboard/ui/feature-tile";
import type { Dictionary } from "@/i18n/dictionary";

type Props = { copy: Dictionary["dashboard"]["presence"]["link"]; href: string };

/** The overview's way into "Is it really you?": a caller says they are family and asks for money, so ask Kin to check with the real person. */
export function PresenceCard({ copy, href }: Props) {
  return <FeatureTile title={copy.title} text={copy.text} link={{ href, label: copy.label }} icon={ShieldQuestionIcon} />;
}
