import { MemberAvatar } from "@/components/dashboard/ui/member-avatar";
import { StatusPill, type PillTone } from "@/components/dashboard/ui/status-pill";
import { RisingFigure } from "@/components/motion/rising-figure";
import { shareColorAt } from "@/components/shared/share-colors";
import { cn } from "@/lib/utils";

type MemberCardProps = {
  memberId: string;
  name: string;
  portrait: string | null;
  shareIndex: number;
  share: string;
  /** Paid in, own pocket, care time, then the total and the target. */
  lines: readonly { label: string; value: string; strong?: boolean }[];
  position: { tone: PillTone; text: string };
  explanation: string;
};

/** One sibling's month: what they gave, what their share asked, and where that leaves them. */
export function MemberCard({ memberId, name, portrait, shareIndex, share, lines, position, explanation }: MemberCardProps) {
  const { dot } = shareColorAt(shareIndex);
  return (
    <article aria-labelledby={`member-${memberId}`} className="surface lift glow-edge group flex min-w-0 flex-col overflow-clip rounded-3xl p-5 sm:p-6">
      {/* The member's share colour, as a lit edge along the top. */}
      <span aria-hidden="true" className={cn("pointer-events-none absolute inset-x-6 top-0 h-1 rounded-b-full", dot)} />
      <span aria-hidden="true" className={cn("pointer-events-none absolute inset-x-10 top-0 h-6 rounded-full opacity-25 blur-xl transition-opacity duration-500 group-hover:opacity-50", dot)} />
      <div className="flex items-center gap-3">
        <span className="rounded-full p-0.5 ring-2 ring-border transition-[box-shadow] duration-500 group-hover:ring-gold/70">
          <MemberAvatar portrait={portrait} name={name} size="md" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={`member-${memberId}`} className="truncate text-lg font-semibold tracking-tight">
            {name}
          </h3>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <span aria-hidden="true" className={cn("size-2.5 rounded-full", dot)} />
            {share}
          </p>
        </div>
      </div>
      <dl className="mt-5 text-sm">
        {lines.map((line) => (
          <div
            key={line.label}
            className={cn(
              "flex items-baseline justify-between gap-3",
              line.strong ? "my-1.5 rounded-xl bg-muted/80 px-3 py-2.5" : "border-b border-dashed py-2.5 last:border-b-0",
            )}
          >
            <dt className={line.strong ? "font-semibold" : "text-muted-foreground"}>{line.label}</dt>
            <dd className={cn("tabular-nums", line.strong ? "font-serif text-xl" : "font-medium")}>
              {line.strong ? <RisingFigure value={line.value} /> : line.value}
            </dd>
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
