import {
  MAX_CALLER_TURNS,
  decideCall,
  hear,
  nextPrompt,
  startIntake,
  type CallVerdict,
  type IntakeState,
  type RecordFacts,
  type ScriptKey,
} from "@kin/domain";

import type { CallLine } from "./call-line.ts";

/** The words for each sentence Kin may say, in the language of the call. Fixed text with no blanks to fill. */
export type CallScript = Readonly<Record<ScriptKey, string>>;

export type CallTurn = { readonly from: "kin" | "caller"; readonly text: string };

export type TakeCallInput = {
  readonly line: CallLine;
  readonly script: CallScript;
  readonly record: RecordFacts;
  readonly currency: string;
};

export type CallOutcome = {
  /** Every sentence said by either side: text only, never audio. */
  readonly transcript: readonly CallTurn[];
  readonly intake: IntakeState;
  /** `null` when the caller said nothing that could be checked. */
  readonly verdict: CallVerdict | null;
  /** Whether the intake ran to the end and Kin gave its reply. */
  readonly completed: boolean;
};

/**
 * Answers one call. Kin discloses what it is, asks five questions, checks the
 * answers against the record with plain code and gives one of two fixed
 * replies. It has no tool that pays, discloses or edits anything: the
 * outcome is returned for the caller of this function to record and to alert
 * the family with.
 */
export async function takeCall({ line, script, record, currency }: TakeCallInput): Promise<CallOutcome> {
  const transcript: CallTurn[] = [];
  const say = async (key: ScriptKey) => {
    transcript.push({ from: "kin", text: script[key] });
    await line.say(script[key]);
  };

  await say("disclosure");
  let intake = startIntake();
  let turns = 0;
  let prompt = nextPrompt(intake);
  let hungUp = false;
  while (prompt !== null && turns < MAX_CALLER_TURNS) {
    await say(prompt);
    const heard = await line.listen();
    turns += 1;
    if (heard === null) {
      hungUp = true;
      break;
    }
    if (heard.trim() !== "") transcript.push({ from: "caller", text: heard.trim() });
    intake = hear(intake, heard);
    prompt = nextPrompt(intake);
  }

  const completed = prompt === null;
  const gaveSomething = intake.said.length > 0;
  // A caller who finished, or who gave us something before hanging up, is checked. A silent one is not.
  const verdict = completed || gaveSomething ? decideCall(intake, record, currency) : null;
  if (completed && verdict !== null) await say(verdict.reply);
  if (!hungUp) await line.hangUp();
  return { transcript, intake, verdict, completed };
}
