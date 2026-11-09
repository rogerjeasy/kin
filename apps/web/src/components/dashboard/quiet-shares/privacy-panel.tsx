import { EyeOffIcon } from "lucide-react";

import { Panel } from "@/components/dashboard/ui/panel";

import type { QuietCopy } from "./quiet-screen";

/** What stays private and what does not, said plainly once on the screen. */
export function PrivacyPanel({ copy }: { copy: QuietCopy["privacy"] }) {
  return (
    <Panel title={copy.title} aside={<EyeOffIcon aria-hidden="true" className="size-6 shrink-0 text-positive" />}>
      <ul className="list-disc space-y-2 ps-5 text-sm text-pretty">
        {copy.items.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </Panel>
  );
}
