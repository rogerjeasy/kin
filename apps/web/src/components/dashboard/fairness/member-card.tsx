import { Avatar } from "@/components/shared/avatar";
import { shareColor } from "@/components/shared/share-colors";
import { StatusPill, type PillTone } from "@/components/dashboard/ui/status-pill";
import type { Sibling } from "@/content/example-family";
import { siblingPortraits } from "@/content/sibling-portraits";

type MemberCardProps = {
  memberId: Sibling;
  name: string;
  share: string;
  /** Paid in, own pocket, care time, then the total and the target. */
  lines: readonly { label: string; value: string; strong?: boolean }[];
  position: { tone: PillTone; text: string };
  explanation: string;
};

/** One sibling's month: what they gave, what their share asked, and where that leaves them. */
export function MemberCard({ memberId, name, share, lines, position, explanation }: MemberCardProps) {
  return (
    <article aria-labelledby={`member-${memberId}`} className="flex min-w-0 flex-col rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
      <div className="flex items-center gap-3">
        <Avatar src={siblingPortraits[memberId]} size="md" />
        <div className="min-w-0 flex-1">
          <h3 id={`member-${memberId}`} className="truncate text-lg font-semibold">
            {name}
          </h3>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <span aria-hidden="true" className={`size-2.5 rounded-full ${shareColor(memberId).dot}`} />
            {share}
          </p>
        </div>
      </div>
      <dl className="mt-5 divide-y text-sm">
        {lines.map((line) => (
          <div key={line.label} className="flex items-baseline justify-between gap-3 py-2.5">
            <dt className={line.strong ? "font-semibold" : "text-muted-foreground"}>{line.label}</dt>
            <dd className={`tabular-nums ${line.strong ? "font-semibold" : ""}`}>{line.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-auto pt-5">
        <StatusPill tone={position.tone} className="text-sm">
          {position.text}
        </StatusPill>
        <p className="mt-3 text-sm text-pretty text-muted-foreground">{explanation}</p>
      </div>
    </article>
  );
}
