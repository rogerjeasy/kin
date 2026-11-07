/**
 * The family office line: the receptionist's side of a call, as plain code
 * (docs/feature-proposals.md section 2). A call is a short intake, a verdict
 * from the record (`checkClaim`) and one fixed reply. Nothing the caller says
 * is an instruction: it is slotted into five answers and compared with the
 * record. The reply is chosen from a closed set and holds no amount, date or
 * name, so there is nothing for a liar to extract and nothing for a model to
 * get wrong.
 */
import { checkClaim, type ClaimFacts, type ClaimResult } from "./claim-check.ts";
import { InvalidDecimalError, centsFromDecimal } from "./money.ts";

/** What the receptionist asks, in order. */
export const INTAKE_QUESTIONS = ["caller", "organization", "amount", "purpose", "reference"] as const;
export type IntakeQuestion = (typeof INTAKE_QUESTIONS)[number];

/** Every sentence Kin may say on the line. The words per language live with the app; the set is closed here. */
export const SCRIPT_KEYS = [
  "disclosure",
  "ask_caller",
  "ask_organization",
  "ask_amount",
  "ask_purpose",
  "ask_reference",
  "reply_handled",
  "reply_no_record",
] as const;
export type ScriptKey = (typeof SCRIPT_KEYS)[number];

const ASK: Readonly<Record<IntakeQuestion, ScriptKey>> = {
  caller: "ask_caller",
  organization: "ask_organization",
  amount: "ask_amount",
  purpose: "ask_purpose",
  reference: "ask_reference",
};

export const MAX_ANSWER_CHARS = 200;
/** A call is short; a caller who goes on past this many turns is hung up on politely. */
export const MAX_CALLER_TURNS = 12;

export type Answers = { readonly [Q in IntakeQuestion]: string | null };

export type IntakeState = {
  readonly answers: Answers;
  /** Every word the caller said, in order, for the pressure classifier and the record. */
  readonly said: readonly string[];
};

export const startIntake = (): IntakeState => ({ answers: { caller: null, organization: null, amount: null, purpose: null, reference: null }, said: [] });

const clean = (text: string): string => text.replace(/\s+/g, " ").trim().slice(0, MAX_ANSWER_CHARS);

/** The question still unanswered, or `null` when intake is complete. */
export function pendingQuestion(state: IntakeState): IntakeQuestion | null {
  return INTAKE_QUESTIONS.find((question) => state.answers[question] === null) ?? null;
}

/** The sentence Kin says next, or `null` when intake is complete. */
export function nextPrompt(state: IntakeState): ScriptKey | null {
  const question = pendingQuestion(state);
  return question === null ? null : ASK[question];
}

/**
 * Takes what the caller said as the answer to the pending question. Silence
 * answers nothing and the question is asked again. The words are stored as
 * data and never read for instructions.
 */
export function hear(state: IntakeState, utterance: string): IntakeState {
  const text = clean(utterance);
  const question = pendingQuestion(state);
  if (text === "" || question === null) return state;
  return { answers: { ...state.answers, [question]: text }, said: [...state.said, text] };
}

/**
 * The first figure in what the caller said, as cents. A transcript carries
 * digits, so "three hundred" is not read. `null` when there is no figure,
 * which the verdict then treats as nothing to compare.
 */
export function spokenAmountCents(text: string, currency: string): number | null {
  const found = /\d[\d,. ]*/u.exec(text);
  if (found === null) return null;
  const figure = found[0]
    .trim()
    .replace(/[ ,](?=\d{3}\b)/g, "")
    .replace(/,/g, ".")
    .replace(/[. ]+$/, "");
  try {
    const cents = centsFromDecimal(figure, currency);
    return cents > 0 ? cents : null;
  } catch (error) {
    if (error instanceof InvalidDecimalError) return null;
    throw error;
  }
}

export type PressureSignal = "urgency" | "secrecy" | "threat" | "unusual_payment";

const SIGNALS: Readonly<Record<PressureSignal, RegExp>> = {
  urgency: /\b(today|right now|immediately|urgent(ly)?|asap|last (chance|warning|notice)|within (the hour|\d+ hours?)|at once|sofort|heute|aujourd'hui|tout de suite|immédiatement|urgente?|ahora mismo|subito|oggi)\b/iu,
  secrecy: /\b(don'?t tell|do not tell|tell (no one|nobody)|keep (this|it) (secret|between us|quiet)|confidential|secret|nicht sagen|niemandem|ne le dites|no se lo (diga|digas)|non dirlo)\b/iu,
  threat: /\b(arrest(ed)?|police|lawsuit|legal action|sue|court|jail|prison|deport(ed)?|cut off|disconnect(ed)?|shut off|suspended|verhaftet|polizei|klage|abgestellt|poursuites|coupé|arrêté|policía|demanda|cortado|polizia|denuncia|tagliato)\b/iu,
  unusual_payment: /\b(gift ?cards?|wire|bitcoin|crypto|western union|prepaid|geschenkkarte|überweisung|carte cadeau|virement|tarjeta de regalo|transferencia|carta regalo|bonifico)\b/iu,
};

/** Urgency, secrecy, threats and odd ways to pay, found by rules in what the caller said. It can raise a flag and never lower one. */
export function pressureSignals(said: readonly string[]): PressureSignal[] {
  const text = said.join(" ");
  return (Object.keys(SIGNALS) as PressureSignal[]).filter((signal) => SIGNALS[signal].test(text));
}

/** The facts of the record a call is checked against: the claim check's, without the claim itself. */
export type RecordFacts = Pick<ClaimFacts, "payees" | "bills" | "payments">;

export type CallVerdict = {
  readonly claimedPayee: string;
  readonly claimedCents: number | null;
  readonly result: ClaimResult;
  readonly pressure: readonly PressureSignal[];
  readonly reply: Extract<ScriptKey, "reply_handled" | "reply_no_record">;
};

/**
 * Decides a finished intake. The verdict is `checkClaim` over the record. The
 * reply is one of two fixed sentences: "handled" when the record already
 * covers the account (open bill, or paid), "no record" for everything else,
 * so an uncertain match is never told to the caller as a yes.
 */
export function decideCall(state: IntakeState, record: RecordFacts, currency: string): CallVerdict {
  const claimedPayee = state.answers.organization ?? "";
  const claimedCents = state.answers.amount === null ? null : spokenAmountCents(state.answers.amount, currency);
  const result = checkClaim({ ...record, claimedPayee, claimedCents });
  const known = result.reason === "open_bill" || result.reason === "already_paid";
  return { claimedPayee, claimedCents, result, pressure: pressureSignals(state.said), reply: known ? "reply_handled" : "reply_no_record" };
}
