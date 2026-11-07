import { CircleCheckIcon, CircleXIcon } from "lucide-react";

import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import { cn } from "@/lib/utils";

export type CheckRow = { id: "chain" | "head" | "ledger" | "settlement" | "wording"; ok: boolean; count: string; alone?: boolean };

type CheckListProps = { copy: Dictionary["dashboard"]["verify"]["checks"]; rows: readonly CheckRow[] };

/** Each thing the verifier checked, passed or failed, in words and with an icon so colour is never the only sign. */
export function CheckList({ copy, rows }: CheckListProps) {
  return (
    <ul className="divide-y">
      {rows.map(({ id, ok, count, alone }) => {
        const Icon = ok ? CircleCheckIcon : CircleXIcon;
        return (
          <li key={id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <Icon aria-hidden="true" className={cn("mt-0.5 size-5 shrink-0", ok ? "text-positive" : "text-danger")} />
            <div className="min-w-0">
              <p className="font-semibold">{copy[id].label}</p>
              <p className="text-sm text-pretty text-muted-foreground">{ok ? fill(id === "head" && alone ? copy.head.okAlone : copy[id].ok, { count }) : copy[id].bad}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
