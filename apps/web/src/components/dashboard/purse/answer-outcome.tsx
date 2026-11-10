import { CheckCircle2Icon, HourglassIcon, OctagonXIcon, SendIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { PursePaymentView } from "@/server/purse";

type Props = { outcome: string; payment: PursePaymentView; copy: Dictionary["dashboard"]["purse"]; money: (cents: number) => string; onAgain: () => void };

/** What her answer did, in one plain sentence, and the way to pay someone else. */
export function AnswerOutcome({ outcome, payment, copy, money, onAgain }: Props) {
  const values = { payee: payment.payeeName, amount: money(payment.cents) };
  const { outcome: words } = copy;
  const view =
    outcome === "approved"
      ? { icon: SendIcon, tone: "text-positive", text: fill(words.approved, values) }
      : outcome === "held"
        ? { icon: HourglassIcon, tone: "text-highlight", text: fill(payment.payeeInBook ? words.held : words.heldNew, values) }
        : outcome === "stopped"
          ? { icon: OctagonXIcon, tone: "text-highlight", text: words.stopped }
          : { icon: CheckCircle2Icon, tone: "text-muted-foreground", text: words.declined };
  const Icon = view.icon;
  return (
    <div className="min-w-0 space-y-5">
      <p role="status" className="flex items-start gap-3 text-2xl leading-snug font-semibold text-balance wrap-anywhere">
        <Icon aria-hidden="true" className={`mt-1 size-7 shrink-0 ${view.tone}`} />
        {view.text}
      </p>
      <Button type="button" variant="outline" onClick={onAgain} className="h-auto min-h-14 max-w-full whitespace-normal px-6 text-lg">
        {words.again}
      </Button>
    </div>
  );
}
