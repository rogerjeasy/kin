"use client";

import { CopyField } from "@/components/dashboard/shift-links/copy-field";
import { CopyBlock } from "@/components/shared/copy-block";
import { Button } from "@/components/ui/button";
import { claudeCodeCommand, mcpJsonConfig } from "@/content/open-kin/connect-snippets";
import type { Dictionary } from "@/i18n/dictionary";

type Props = { copy: Dictionary["openKin"]["token"]; token: string; endpoint: string; onDone: () => void };

/** A new delegation token, shown this once, with the lines that connect an assistant with it. */
export function TokenReveal({ copy, token, endpoint, onDone }: Props) {
  const labels = { copyLabel: copy.copy, copiedLabel: copy.copied, failedLabel: copy.failed };
  return (
    <section aria-labelledby="token-reveal" className="grid min-w-0 gap-4 rounded-2xl border-2 border-highlight/40 bg-highlight/5 p-4 sm:p-5">
      <div className="min-w-0">
        <h3 id="token-reveal" className="font-semibold">
          {copy.title}
        </h3>
        <p className="mt-1 text-sm text-pretty text-muted-foreground">{copy.text}</p>
      </div>
      <CopyField label={copy.label} value={token} {...labels} />
      <CopyBlock label={copy.claudeCode} value={claudeCodeCommand(endpoint, token)} {...labels} />
      <CopyBlock label={copy.config} value={mcpJsonConfig(endpoint, token)} {...labels} />
      <Button type="button" variant="outline" onClick={onDone} className="w-full sm:w-auto">
        {copy.done}
      </Button>
    </section>
  );
}
