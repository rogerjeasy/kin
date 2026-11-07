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
      <ul className="space-y-2 text-pretty">
        {lines.map((line) => (
          <li key={line} className="wrap-anywhere">
            {line}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
