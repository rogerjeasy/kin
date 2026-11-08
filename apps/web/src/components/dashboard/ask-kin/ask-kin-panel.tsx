"use client";

import { useState } from "react";

import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";

import { AskKinForm } from "./ask-kin-form";
import { AskKinResult } from "./ask-kin-result";
import { AskKinSuggestions } from "./ask-kin-suggestions";
import { useAskKin } from "./use-ask-kin";

type Props = {
  locale: Locale;
  copy: Dictionary["askKin"];
  suggestions: readonly string[];
  /** A question carried here from a suggestion elsewhere, filled in but not yet asked. */
  initialQuestion: string;
  maxLength: number;
};

/** Ask Kin: the question, the suggestions, and the answer with how Kin found it. */
export function AskKinPanel({ locale, copy, suggestions, initialQuestion, maxLength }: Props) {
  const [question, setQuestion] = useState(initialQuestion);
  const { state, ask } = useAskKin(locale);
  const busy = state.status === "asking";
  const pick = (text: string) => {
    setQuestion(text);
    void ask(text);
  };

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-2">
      <div className="min-w-0 space-y-5 rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
        <AskKinForm value={question} busy={busy} maxLength={maxLength} copy={copy.form} onChange={setQuestion} onAsk={() => void ask(question.trim())} />
        <AskKinSuggestions label={copy.suggestions.label} questions={suggestions} onPick={pick} disabled={busy} />
      </div>
      <div className="min-w-0 rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
        <AskKinResult state={state} copy={copy} />
      </div>
    </div>
  );
}
