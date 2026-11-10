"use client";

import { useState } from "react";

import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { fill } from "@/i18n/template";

import { AskKinForm } from "./ask-kin-form";
import { AskKinResult } from "./ask-kin-result";
import { AskKinSuggestions } from "./ask-kin-suggestions";
import { DemoLimitCard } from "./demo-limit-card";
import { DemoLimitDialog, type DemoLimitLinks } from "./demo-limit-dialog";
import { DemoQuestionsLeft } from "./demo-questions-left";
import { useAskKin } from "./use-ask-kin";

type Props = {
  locale: Locale;
  copy: Dictionary["askKin"];
  suggestions: readonly string[];
  /** A question carried here from a suggestion elsewhere, filled in but not yet asked. */
  initialQuestion: string;
  maxLength: number;
  /** The demo's questions: how many there are and how many are left, or `null` when this viewer's are not counted. */
  demoQuestions: { readonly total: number; readonly left: number } | null;
  /** Where a demo visitor goes to keep asking. */
  links: DemoLimitLinks;
};

/** The ink stage keeps its own dark colours in both themes. */
const inkStage = { "data-theme": "dark" };

/** Ask Kin: the question, the suggestions, and the answer with how Kin found it. */
export function AskKinPanel({ locale, copy, suggestions, initialQuestion, maxLength, demoQuestions, links }: Props) {
  const [question, setQuestion] = useState(initialQuestion);
  const [limitOpen, setLimitOpen] = useState(false);
  const { state, ask, questionsLeft } = useAskKin(locale, demoQuestions?.left ?? null, () => setLimitOpen(true));
  const busy = state.status === "asking";
  const total = demoQuestions?.total ?? 0;
  const count = (value: number) => new Intl.NumberFormat(locale).format(value);
  const limitTitle = fill(copy.demoLimit.title, { total: count(total) });
  const spent = questionsLeft !== null && questionsLeft <= 0;
  const pick = (text: string) => {
    setQuestion(text);
    void ask(text);
  };

  return (
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="surface min-w-0 space-y-6 rounded-3xl p-5 sm:p-6">
        {spent ? (
          <DemoLimitCard title={limitTitle} text={copy.demoLimit.text} links={links} />
        ) : (
          <>
            {questionsLeft !== null ? <DemoQuestionsLeft left={questionsLeft} total={total} label={fill(copy.demoLimit.left, { left: count(questionsLeft), total: count(total) })} /> : null}
            <AskKinForm value={question} busy={busy} maxLength={maxLength} copy={copy.form} onChange={setQuestion} onAsk={() => void ask(question.trim())} />
            <AskKinSuggestions label={copy.suggestions.label} questions={suggestions} onPick={pick} disabled={busy} />
          </>
        )}
      </div>
      <div {...inkStage} className="aurora relative min-w-0 overflow-clip rounded-3xl p-5 text-foreground shadow-xl ring-1 ring-band-border sm:p-7 lg:min-h-112">
        <AskKinResult state={state} copy={copy} />
      </div>
      <DemoLimitDialog open={limitOpen} onOpenChange={setLimitOpen} title={limitTitle} text={copy.demoLimit.text} links={links} stay={copy.demoLimit.stay} />
    </div>
  );
}
