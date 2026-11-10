import { EyeOffIcon, ShieldCheckIcon } from "lucide-react";

import { Panel } from "@/components/dashboard/ui/panel";

import type { QuietCopy } from "./quiet-screen";

/** What stays private and what does not, said plainly once on the screen. */
export function PrivacyPanel({ copy }: { copy: QuietCopy["privacy"] }) {
  return (
    <Panel title={copy.title} aside={<EyeOffIcon aria-hidden="true" className="size-6 shrink-0 text-positive" />}>
      <ul className="space-y-3 text-sm text-pretty">
        {copy.items.map((line) => (
          <li key={line} className="flex gap-3">
            <span aria-hidden="true" className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-positive/10 text-positive ring-1 ring-positive/25 ring-inset">
              <ShieldCheckIcon className="size-3.5" />
            </span>
            <span className="min-w-0">{line}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
