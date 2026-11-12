import { ShieldCheckIcon } from "lucide-react";

import { FeatureTile } from "@/components/dashboard/ui/feature-tile";

type SafetyPanelProps = {
  title: string;
  text: string;
  /** Kin's rule, said once beneath: it tells, and never asks for secrets. Left out when nothing was checked yet. */
  rule?: string;
  link?: { href: string; label: string };
};

/** The month's fraud check, told as what happened and what Kin did, or that nothing needed checking. */
export function SafetyPanel({ title, text, rule, link }: SafetyPanelProps) {
  return (
    <FeatureTile title={title} text={text} link={link} icon={ShieldCheckIcon} tone="positive">
      {rule ? <p className="rounded-lg bg-muted px-3 py-2 font-serif text-base">{rule}</p> : null}
    </FeatureTile>
  );
}
