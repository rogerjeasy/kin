import { AnimatePresence, motion } from "motion/react";

import { ChatBubble } from "@/components/dashboard/ai/chat-bubble";
import { KinMark } from "@/components/dashboard/ai/kin-mark";
import { KinThinking } from "@/components/dashboard/ai/kin-thinking";
import type { Dictionary } from "@/i18n/dictionary";

import { AskKinAnswer } from "./ask-kin-answer";
import { AskKinRaisedCard } from "./ask-kin-raised-card";
import { AskKinTrace } from "./ask-kin-trace";
import type { AskKinState } from "./use-ask-kin";

type Props = { state: AskKinState; copy: Dictionary["askKin"] };

/**
 * Where the answer appears. The region is announced politely when it
 * changes, so a screen reader hears the answer without moving focus.
 */
export function AskKinResult({ state, copy }: Props) {
  const turn = state.status === "idle" ? "idle" : `${state.status}:${state.question}`;
  return (
    <div aria-live="polite" aria-busy={state.status === "asking"} className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 items-center gap-3 border-b border-band-border pb-4">
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-gold shadow-[0_0_12px_2px_rgb(var(--glow-gold)/0.6)]" />
        <h2 className="min-w-0 text-lg font-semibold tracking-tight">{copy.answer.heading}</h2>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={turn} initial={{ y: 14 }} animate={{ y: 0 }} exit={{ y: -10 }} transition={{ type: "spring", stiffness: 260, damping: 26 }} className="min-w-0 space-y-5">
          {state.status === "idle" ? (
            <div className="flex min-w-0 flex-col items-center gap-5 py-10 text-center">
              <KinMark size="lg" className="motion-safe:animate-float" />
              <p className="max-w-xs text-pretty text-muted-foreground">{copy.answer.empty}</p>
            </div>
          ) : null}
          {state.status === "asking" ? (
            <>
              <ChatBubble from="person">
                <p className="text-base">{state.question}</p>
              </ChatBubble>
              <KinThinking label={copy.form.asking} />
            </>
          ) : null}
          {state.status === "failed" ? (
            <>
              <ChatBubble from="person">
                <p className="text-base">{state.question}</p>
              </ChatBubble>
              <ChatBubble from="kin" className="border-danger/40">
                <p role="alert" className="text-danger">
                  {copy.errors[state.reason]}
                </p>
              </ChatBubble>
            </>
          ) : null}
          {state.status === "answered" ? (
            <>
              <AskKinAnswer question={state.question} answer={state.answer} copy={copy.answer} />
              <div className="min-w-0 space-y-4 sm:ps-12">
                <AskKinRaisedCard raised={state.answer.proposal} copy={copy} />
                <AskKinTrace steps={state.answer.steps} copy={copy.answer} />
              </div>
            </>
          ) : null}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
