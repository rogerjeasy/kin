import { Avatar } from "@/components/shared/avatar";
import { shareColor } from "@/components/shared/share-colors";
import { siblingPortraits } from "@/content/sibling-portraits";
import type { Sibling } from "@/content/example-family";

import { MeterBar } from "./meter-bar";
import { StatusPill, type PillTone } from "./status-pill";

export type GivenRow = {
  memberId: Sibling;
  name: string;
  /** "30%". */
  share: string;
  givenCents: number;
  targetCents: number;
  /** "Gave 480.00 · share 354.00". */
  detail: string;
  /** The bar in words. */
  label: string;
  position: { tone: PillTone; text: string };
};

/**
 * What each sibling gave, as a bar, with their agreed share marked across it.
 * Every bar shares one scale, so the lengths compare.
 */
export function GivenBars({ rows }: { rows: readonly GivenRow[] }) {
  const max = Math.max(...rows.flatMap((row) => [row.givenCents, row.targetCents]));

  return (
    <ul className="space-y-5">
      {rows.map((row) => (
        <li key={row.memberId} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
          <Avatar src={siblingPortraits[row.memberId]} size="sm" className="row-span-2 sm:row-span-1" />
          <div className="min-w-0">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold">{row.name}</span>
              <span className="text-sm text-muted-foreground">{row.share}</span>
            </p>
            <MeterBar value={row.givenCents} max={max} target={row.targetCents} fill={shareColor(row.memberId).fill} label={row.label} className="mt-2" />
            <p className="mt-1.5 text-sm text-muted-foreground tabular-nums">{row.detail}</p>
          </div>
          <StatusPill tone={row.position.tone} className="justify-self-start sm:justify-self-end">
            {row.position.text}
          </StatusPill>
        </li>
      ))}
    </ul>
  );
}
