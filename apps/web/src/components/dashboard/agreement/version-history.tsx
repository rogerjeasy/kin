import { Panel } from "@/components/dashboard/ui/panel";
import { StatusPill, type PillTone } from "@/components/dashboard/ui/status-pill";

export type HistoryItem = { readonly id: string; readonly title: string; readonly status: string; readonly tone: PillTone; readonly starts: string; readonly accepted: string };

/** Every version the family has written, newest first. Versions are never changed, only replaced. */
export function VersionHistory({ title, items }: { title: string; items: readonly HistoryItem[] }) {
  return (
    <Panel title={title} flush>
      <ol className="divide-y">
        {items.map((item) => (
          <li key={item.id} className="grid min-w-0 gap-1 px-5 py-4 sm:px-6">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="font-semibold">{item.title}</span>
              <StatusPill tone={item.tone}>{item.status}</StatusPill>
            </div>
            <p className="text-sm text-muted-foreground">{item.starts}</p>
            <p className="text-sm text-muted-foreground wrap-anywhere">{item.accepted}</p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
