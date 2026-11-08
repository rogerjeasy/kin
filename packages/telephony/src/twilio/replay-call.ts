import { MAX_ANSWER_CHARS, type RecordFacts } from "@kin/domain";

import type { CallLine } from "../call-line.ts";
import { takeCall, type CallOutcome, type CallScript } from "../take-call.ts";

/**
 * What the caller said before this turn, in the words of the call's state:
 * answers, and the count of silences.
 */
export type CallerHistory = { readonly heard: readonly string[]; readonly silent: number };

export type ReplayInput = CallerHistory & {
  readonly script: CallScript;
  readonly record: RecordFacts;
  readonly currency: string;
};

export type Replay = {
  /** The sentences Kin says now: the disclosure and first question at the start, otherwise the one that follows the last answer. */
  readonly sentences: readonly string[];
  readonly outcome: CallOutcome;
  /** Whether the receptionist is waiting for the caller's next words. Otherwise the call is over. */
  readonly awaiting: boolean;
};

/** The same cleaning `hear` does, so a stored answer is already what the receptionist would keep. */
export const cleanSpeech = (text: string): string => text.replace(/\s+/g, " ").trim().slice(0, MAX_ANSWER_CHARS);

/**
 * Runs the one receptionist, `takeCall`, over everything the caller has said
 * so far, as a telephone line that has only that to give. When it runs out the
 * receptionist is waiting, and the sentence it last said is the one to speak
 * next. A webhook has no open line to hold, so this is how a call that
 * `takeCall` conducts in one pass is conducted a turn at a time without a
 * second copy of the intake, the verdict or the sentences. It is plain code over
 * data: the caller's words are replayed as answers and never obeyed.
 */
export async function replayCall(input: ReplayInput): Promise<Replay> {
  const said: string[] = [...Array<string>(input.silent).fill(""), ...input.heard];
  let awaiting = false;
  const line: CallLine = {
    say: () => Promise.resolve(),
    listen: () => {
      const next = said.shift();
      if (next === undefined) awaiting = true;
      return Promise.resolve(next ?? null);
    },
    hangUp: () => Promise.resolve(),
  };
  const outcome = await takeCall({ line, script: input.script, record: input.record, currency: input.currency });
  const kin = outcome.transcript.filter((turn) => turn.from === "kin").map((turn) => turn.text);
  const first = input.heard.length === 0 && input.silent === 0;
  const last = kin.at(-1);
  return { sentences: first ? kin : last === undefined ? [] : [last], outcome, awaiting };
}
