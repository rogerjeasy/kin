import type { LucideIcon } from "lucide-react";

import { EmptyState } from "./empty-state";
import { Panel } from "./panel";

type EmptyPanelProps = { title: string; description?: string; text: string; icon?: LucideIcon; className?: string; link?: { href: string; label: string } };

/** A screen region with nothing in it yet: its title, and a sentence on what will appear. */
export function EmptyPanel({ title, description, text, icon, className, link }: EmptyPanelProps) {
  return (
    <Panel title={title} description={description} className={className} link={link}>
      <EmptyState text={text} icon={icon} />
    </Panel>
  );
}
