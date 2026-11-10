import { AlertTriangleIcon, BanIcon, BellRingIcon, CheckCircle2Icon, HelpCircleIcon, PhoneIcon } from "lucide-react";

import { shownVerdict, VerdictPill } from "@/components/dashboard/letters/verdict-pill";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import { cn } from "@/lib/utils";
import type { OfficeCallResult } from "@/server/office-line";

import { CallTranscript } from "./call-transcript";

type Props = { result: Extract<OfficeCallResult, { ok: true }>; copy: Dictionary["dashboard"]["officeLine"] };

/** The light behind the verdict, by what the record says. Decorative: the pill carries the words. */
const GLOW = {
  match: { box: "bg-positive/10 ring-positive/30 shadow-[0_0_40px_-12px_var(--positive)]", icon: CheckCircle2Icon, tint: "text-positive" },
  no_match: { box: "bg-danger/10 ring-danger/30 shadow-[0_0_40px_-12px_var(--danger)]", icon: AlertTriangleIcon, tint: "text-danger" },
  already_paid: { box: "bg-danger/10 ring-danger/30 shadow-[0_0_40px_-12px_var(--danger)]", icon: BanIcon, tint: "text-danger" },
  unclear: { box: "bg-highlight/10 ring-gold/40 shadow-[0_0_40px_-12px_rgb(var(--glow-gold))]", icon: HelpCircleIcon, tint: "text-highlight" },
} as const;

/** What came of a call: the transcript beside the verdict, the pressure heard and what the family was told. */
export function CallOutcome({ result, copy }: Props) {
  const look = GLOW[shownVerdict(result.verdict, result.payeeId)];
  return (
    <div role="status" className="surface grid min-w-0 gap-5 rounded-3xl p-4 motion-safe:animate-scale-in sm:p-5 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <div className="min-w-0 rounded-2xl bg-muted/70 p-3 sm:p-4">
        <p aria-hidden="true" className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <PhoneIcon className="size-3.5" />
          <span className="h-px flex-1 bg-border" />
        </p>
        <CallTranscript turns={result.transcript} labels={{ kin: copy.kin, caller: copy.caller, title: copy.transcriptTitle }} />
      </div>
      <div className="enter-stagger flex min-w-0 flex-col gap-4 self-start xl:sticky xl:top-28">
        <div className={cn("flex min-w-0 flex-col items-start gap-3 rounded-2xl p-4 ring-1 ring-inset min-[420px]:flex-row min-[420px]:gap-4", look.box)}>
          <span aria-hidden="true" className={cn("inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-card shadow-sm motion-safe:animate-scale-in", look.tint)}>
            <look.icon className="size-6" />
          </span>
          <div className="min-w-0 space-y-2">
            <h3 className="text-sm font-semibold">{copy.verdictTitle}</h3>
            <div className="[&>span]:px-3.5 [&>span]:py-2 [&>span]:text-base">
              <VerdictPill verdict={result.verdict} payeeId={result.payeeId} labels={copy.verdicts} />
            </div>
          </div>
        </div>
        {result.pressure.length > 0 ? (
          <div className="min-w-0 space-y-1.5 border-s-2 border-danger/50 ps-4">
            <h3 className="text-sm font-semibold">{copy.pressureTitle}</h3>
            <p className="text-sm font-medium">{result.pressure.map((signal) => copy.signals[signal]).join(", ")}</p>
          </div>
        ) : null}
        <div className="min-w-0 space-y-2 rounded-2xl border bg-card p-4 shadow-sm">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <BellRingIcon aria-hidden="true" className="size-4 shrink-0 text-highlight" />
            {copy.alertTitle}
          </h3>
          <p className="text-sm wrap-anywhere">{result.alert}</p>
          <p className="text-sm text-muted-foreground">{fill(copy.told, { count: String(result.told) })}</p>
        </div>
      </div>
    </div>
  );
}
