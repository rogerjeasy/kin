import { BookOpenCheckIcon, HandIcon, ShieldOffIcon } from "lucide-react";

import { IconTile } from "@/components/dashboard/ui/icon-tile";
import type { Dictionary } from "@/i18n/dictionary";

type Props = { copy: Dictionary["openKin"]["boundary"] };

const ITEMS = [
  { key: "read", icon: BookOpenCheckIcon, tone: "" },
  { key: "propose", icon: HandIcon, tone: "" },
  { key: "never", icon: ShieldOffIcon, tone: "bg-danger/10 text-danger" },
] as const;

/** The boundary in three lines: what an outside assistant reads, may propose, and can never do. */
export function BoundaryList({ copy }: Props) {
  return (
    <ul aria-label={copy.label} className="grid min-w-0 gap-3 sm:grid-cols-3">
      {ITEMS.map(({ key, icon, tone }) => (
        <li key={key} className="flex min-w-0 items-start gap-3 rounded-2xl border bg-card p-4 shadow-xs">
          <IconTile icon={icon} className={tone} />
          <p className="min-w-0">
            <strong className="block font-semibold text-balance">{copy[key].title}</strong>
            <span className="mt-1 block text-sm text-pretty text-muted-foreground">{copy[key].text}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}
