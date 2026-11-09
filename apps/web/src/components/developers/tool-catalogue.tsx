import { BookOpenCheckIcon, HandIcon } from "lucide-react";

import { StatusPill } from "@/components/dashboard/ui/status-pill";

type Tool = { readonly name: string; readonly kind: "read" | "propose"; readonly description: string };

type Props = { tools: readonly Tool[]; kinds: { readonly read: string; readonly propose: string } };

/** The MCP server's tools, from the catalogue itself, each marked as reading or proposing. None approves. */
export function ToolCatalogue({ tools, kinds }: Props) {
  return (
    <ul className="mt-4 grid min-w-0 divide-y rounded-2xl border bg-card">
      {tools.map((tool) => (
        <li key={tool.name} className="grid min-w-0 gap-1.5 p-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <code dir="ltr" className="font-mono text-sm font-semibold wrap-anywhere">
              {tool.name}
            </code>
            <StatusPill tone={tool.kind === "read" ? "neutral" : "waiting"} icon={tool.kind === "read" ? BookOpenCheckIcon : HandIcon}>
              {kinds[tool.kind]}
            </StatusPill>
          </div>
          {/* The catalogue's own wording, which is also what an assistant's model reads. */}
          <p lang="en" className="text-sm text-pretty text-muted-foreground">
            {tool.description}
          </p>
        </li>
      ))}
    </ul>
  );
}
