import { CheckIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/locales";
import { answerProposalAction } from "@/server/circle-actions";

type AnswerButtonsProps = { locale: Locale; proposalId: string; approve: string; decline: string };

/**
 * The viewer's yes or no. Each is a form, so the answer reaches the server,
 * which checks the viewer's seat and role, records it, and lets the approval
 * engine decide.
 */
export function AnswerButtons({ locale, proposalId, approve, decline }: AnswerButtonsProps) {
  const field = (decision: "approve" | "reject") => (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="proposal" value={proposalId} />
      <input type="hidden" name="decision" value={decision} />
    </>
  );
  return (
    <div className="flex flex-wrap gap-2">
      <form action={answerProposalAction}>
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
    </div>
  );
}
