import { CheckIcon, ShieldCheckIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/locales";
import { answerProposalAction } from "@/server/circle-actions";

type AnswerButtonsProps = {
  locale: Locale;
  proposalId: string;
  approve: string;
  decline: string;
  /** Real money: a yes goes through a fresh sign-in with a second factor first. */
  freshCheck?: { note: string } | null;
};

/**
 * The viewer's yes or no. Each is a form, so the answer reaches the server,
 * which checks the viewer's seat and role, records it, and lets the approval
 * engine decide. A yes to real money is posted to the step-up route instead,
 * which records it only after the fresh check.
 */
export function AnswerButtons({ locale, proposalId, approve, decline, freshCheck = null }: AnswerButtonsProps) {
  const field = (decision: "approve" | "reject") => (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="proposal" value={proposalId} />
      <input type="hidden" name="decision" value={decision} />
    </>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={freshCheck ? "/auth/step-up" : answerProposalAction} method="post">
        {field("approve")}
        <Button type="submit" size="sm" className="min-h-11">
          <CheckIcon aria-hidden="true" />
          {approve}
        </Button>
      </form>
      <form action={answerProposalAction}>
        {field("reject")}
        <Button type="submit" size="sm" variant="outline" className="min-h-11">
          <XIcon aria-hidden="true" />
          {decline}
        </Button>
      </form>
      {freshCheck ? (
        <p className="flex min-w-0 basis-full items-center gap-1.5 text-sm text-muted-foreground">
          <ShieldCheckIcon aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0">{freshCheck.note}</span>
        </p>
      ) : null}
    </div>
  );
}
