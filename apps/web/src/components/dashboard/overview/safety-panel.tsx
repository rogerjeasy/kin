import { ShieldCheckIcon } from "lucide-react";

import { Panel } from "@/components/dashboard/ui/panel";

type SafetyPanelProps = {
  title: string;
  text: string;
  rule: string;
  link: { href: string; label: string };
  className?: string;
};

/** The month's fraud check, told as what happened and what Kin did. */
export function SafetyPanel({ title, text, rule, link, className }: SafetyPanelProps) {
  return (
    <Panel
      title={title}
      link={link}
      className={className}
      aside={
        <span aria-hidden="true" className="inline-flex size-10 items-center justify-center rounded-xl bg-positive/10 text-positive">
          <ShieldCheckIcon className="size-5" />
        </span>
      }
    >
      <p className="text-pretty">{text}</p>
      <p className="mt-4 rounded-xl bg-muted px-4 py-3 font-serif text-lg">{rule}</p>
    </Panel>
  );
}
