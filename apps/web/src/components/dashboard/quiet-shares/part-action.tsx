"use client";

import type { OwnPartRecord } from "@kin/db";
import { decimalAmount } from "@kin/domain";
import { ExternalLinkIcon, PartyPopperIcon } from "lucide-react";
import { useState } from "react";

import { TopUpSheet } from "@/components/dashboard/top-up/top-up-sheet";
import { StatusPill } from "@/components/dashboard/ui/status-pill";
import { Button } from "@/components/ui/button";
import { fill } from "@/i18n/template";
import { formatters } from "@/lib/format";
import type { AskView } from "@/server/quiet-shares";

import type { QuietScreen } from "./quiet-screen";
import { useQuietShare } from "./use-quiet-share";

type Props = { screen: QuietScreen; ask: AskView; part: OwnPartRecord };

/**
 * The PayPal step for the person's own part, once everyone has said yes. In a
 * demo circle it is simulated and says so. In a real circle: PayPal checkout
 * at the part's amount (with Pay Later where PayPal offers it), the person's
 * monthly share revised on PayPal, or an invoice an organizer sends.
 */
export function PartAction({ screen, ask, part }: Props) {
  const { copy } = screen;
  const words = copy.part;
  const format = formatters(screen.locale, screen.currency, screen.timezone);
  const { send, pending, error } = useQuietShare(screen.seat);
  const [approvalUrl, setApprovalUrl] = useState(part.approvalUrl);
  const firstCents = part.perMonth[0] ?? part.cents;
  const amount = format.money(firstCents);
  const method = part.method ?? "checkout";

  return (
    <div className="min-w-0 space-y-3 border-t pt-4">
      <p className="flex items-center gap-2 font-semibold">
        <PartyPopperIcon aria-hidden="true" className="size-5 shrink-0 text-positive" />
        <span className="min-w-0">{words.agreedTitle}</span>
      </p>
      <p className="text-sm text-pretty">{fill(words.agreedText, { total: format.money(ask.costCents) })}</p>
      {part.cents === 0 ? (
        <p className="text-sm">{words.nothingToPay}</p>
      ) : ask.simulated ? (
        <div className="min-w-0 space-y-2 rounded-xl border border-dashed p-3">
          <StatusPill tone="neutral">{copy.simulated}</StatusPill>
          <p className="text-sm">{fill(words.simulated[method], { amount })}</p>
        </div>
      ) : method === "invoice" ? (
        <p className="text-sm">{fill(words.invoiceReal, { amount })}</p>
      ) : method === "monthly_share" ? (
        approvalUrl ? (
          <a href={approvalUrl} rel="noreferrer noopener" className="inline-flex min-h-11 items-center gap-1.5 font-semibold underline underline-offset-4">
            <ExternalLinkIcon aria-hidden="true" className="size-4 shrink-0" />
            {words.revise}
          </a>
        ) : (
          <Button
            type="button"
            disabled={pending}
            className="h-auto min-h-11 max-w-full whitespace-normal"
            onClick={async () => {
              const reply = await send({ operation: "prepare", askId: ask.id });
              if (reply.ok && reply.approvalUrl) setApprovalUrl(reply.approvalUrl);
            }}
          >
            {pending ? words.preparing : words.prepare}
          </Button>
        )
      ) : screen.checkout ? (
        <TopUpSheet
          locale={screen.locale}
          copy={screen.checkout.copy}
          circle={screen.checkout.circleName}
          clientId={screen.checkout.clientId}
          sdkUrl={screen.checkout.sdkUrl}
          currency={screen.currency}
          presets={[]}
          limits={screen.checkout.limits}
          initialAmount={decimalAmount({ cents: firstCents, currency: screen.currency })}
          triggerLabel={words.pay}
        />
      ) : (
        <p className="text-sm text-muted-foreground">{copy.errors.unavailable}</p>
      )}
      {error ? <p role="alert" className="text-sm text-danger">{copy.errors[error]}</p> : null}
    </div>
  );
}
