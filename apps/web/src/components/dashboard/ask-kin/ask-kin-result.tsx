import type { Dictionary } from "@/i18n/dictionary";

import { AskKinAnswer } from "./ask-kin-answer";
import { AskKinProposal } from "./ask-kin-proposal";
import { AskKinTrace } from "./ask-kin-trace";
import type { AskKinState } from "./use-ask-kin";

type Props = { state: AskKinState; copy: Dictionary["askKin"] };

/**
 * Where the answer appears. The region is announced politely when it
 * changes, so a screen reader hears the answer without moving focus.
 */
export function AskKinResult({ state, copy }: Props) {
  return (
    <div aria-live="polite" aria-busy={state.status === "asking"} className="min-w-0 space-y-4">
      <h2 className="text-lg font-semibold">{copy.answer.heading}</h2>
      {state.status === "idle" ? <p className="text-muted-foreground">{copy.answer.empty}</p> : null}
      {state.status === "asking" ? <p className="text-muted-foreground">{copy.form.asking}</p> : null}
      {state.status === "failed" ? (
        <p role="alert" className="text-danger">
          {copy.errors[state.reason]}
        </p>
      ) : null}
      {state.status === "answered" ? (
        <>
          <AskKinAnswer question={state.question} answer={state.answer} copy={copy.answer} />
          {state.answer.proposal ? <AskKinProposal href={state.answer.proposal.href} copy={state.answer.proposal.kind === "purse_payment" ? copy.purseProposal : copy.proposal} /> : null}
          <AskKinTrace steps={state.answer.steps} copy={copy.answer} />
        </>
      ) : null}
    </div>
  );
}
