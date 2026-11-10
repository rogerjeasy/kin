import { ScrollTextIcon, SparklesIcon } from "lucide-react";

import { ChatBubble } from "@/components/dashboard/ai/chat-bubble";
import { StatusPill } from "@/components/dashboard/ui/status-pill";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

import type { AskKinAnswer as Answer } from "./use-ask-kin";

type Props = { question: string; answer: Answer; copy: Dictionary["askKin"]["answer"] };

/** The question asked, Kin's answer, and who wrote the words: Claude, or Kin's fixed wording from the record. */
export function AskKinAnswer({ question, answer, copy }: Props) {
  const byClaude = answer.source === "claude";
  return (
    <div className="min-w-0 space-y-4">
      <ChatBubble from="person">
        <p className="text-base">“{question}”</p>
      </ChatBubble>
      <ChatBubble from="kin" className="space-y-3 px-5 py-4">
        <p className="font-serif text-xl leading-snug text-pretty">{answer.answer}</p>
        <StatusPill tone={byClaude ? "positive" : "neutral"} icon={byClaude ? SparklesIcon : ScrollTextIcon} className="wrap-anywhere">
          {byClaude ? fill(copy.claude, { model: answer.model }) : copy.template}
        </StatusPill>
      </ChatBubble>
    </div>
  );
}
