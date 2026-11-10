import { Panel } from "@/components/dashboard/ui/panel";
import { StatusPill, type PillTone } from "@/components/dashboard/ui/status-pill";

type Props = {
  title: string;
  /** Who must say yes (or why not), from the real approval engine. */
  approval: { text: string; tone: PillTone };
  /** What the pool holds and whether it covers the bill. */
  lines: readonly string[];
};

/** A hypothetical bill put through the approval rules and the pool's cash. */
export function BillRehearsal({ title, approval, lines }: Props) {
  return (
    <Panel title={title} aside={<StatusPill tone={approval.tone}>{approval.text}</StatusPill>}>
      <ul className="enter-stagger space-y-2 text-pretty">
        {lines.map((line) => (
          <li key={line} className="flex min-w-0 items-start gap-2.5 wrap-anywhere">
            <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-gold shadow-[0_0_8px_2px_rgb(var(--glow-gold)/0.5)]" />
            <span className="min-w-0">{line}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
