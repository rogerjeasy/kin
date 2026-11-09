/**
 * "Is it really you?": the parent was pressed for money by a voice that says it
 * is family, and asks Kin. Kin cannot hear the call and does not try to. It asks
 * the real person, on their real phone, whether it is them, and tells the parent
 * what they answered.
 *
 * Everything here is plain code: what the parent said is read for scam markers
 * by rules, the claimed person is matched against the family's trusted voices,
 * the check moves through a short state machine, and what Kin says back is one
 * sentence chosen from a closed set. The model may help turn a frightened
 * account into fields (`packages/agent`), and never decides any of this. What
 * the caller said, and what the parent repeated, is data and never an
 * instruction.
 */
import { sameName } from "./claim-check.ts";
import { InvalidDecimalError, centsFromDecimal } from "./money.ts";
import { spokenNumbers } from "./number-words.ts";

/** The purpose key of the one payment a family may raise to a person who confirmed it was really them asking for help. */
export const HELP_PURPOSE = "family_help";
/** The spending category such help is recorded under, and the category of its payee: a payee of this category is a trusted voice and nothing else. */
export const HELP_CATEGORY = "family_help";

/** How long Kin waits for the real person before it tells the parent it could not reach them. */
export const PRESENCE_ASK_SECONDS = 90;
/** How long the person's link works. A late "not me" still counts. */
export const PRESENCE_LINK_MINUTES = 15;
/** How long outgoing money stays held after someone said "not me": the family has been told and decides when to lift it. */
export const PRESENCE_HOLD_HOURS = 24;
/** The most checks a circle can open in an hour. Each one texts a real person, so a flood is refused. */
export const PRESENCE_CHECKS_PER_HOUR = 6;
export const MAX_ACCOUNT_CHARS = 1_200;

// ---------------------------------------------------------------------------
// Scam markers
// ---------------------------------------------------------------------------

export const SCAM_MARKERS = ["secrecy", "urgency", "gift_cards", "crypto_atm", "courier_pickup", "wire"] as const;
export type ScamMarker = (typeof SCAM_MARKERS)[number];

/** The markers that name a way to pay no family member needs. Any one of them is a red flag on its own. */
export const UNUSUAL_ROUTES = ["gift_cards", "crypto_atm", "courier_pickup", "wire"] as const satisfies readonly ScamMarker[];

const MARKER_RULES: Readonly<Record<ScamMarker, RegExp>> = {
  secrecy:
    /\b(don'?t tell|do not tell|tell (no one|nobody)|keep (this|it) (secret|between us|quiet)|between us|secret|nicht sagen|niemandem|ne le dis|ne dis (rien|à personne)|ne le dites|no se lo (diga|digas)|no (le )?digas? nada|non dirlo|non dire niente)\b/iu,
  urgency:
    /\b(right now|immediately|urgent(ly)?|asap|today|tonight|within (the hour|\d+ (minutes|hours?))|at once|hurry|quick(ly)?|sofort|heute|dringend|tout de suite|immédiatement|vite|ahora mismo|enseguida|rápido|subito|urgente|in fretta)\b/iu,
  gift_cards: /\b(gift ?cards?|itunes|google play card|steam card|prepaid cards?|geschenkkarten?|cartes? cadeaux?|tarjetas? de regalo|carte regalo|carta regalo)\b/iu,
  crypto_atm: /\b(bitcoin|crypto(currency)?|crypto atm|bitcoin atm|coinbase|kryptowährung|cryptomonnaie|criptomoneda|criptovaluta)\b/iu,
  courier_pickup:
    /\b(courier|messenger|(someone|somebody|a man|a person|a driver|a runner|a friend of mine|a lawyer) (will )?(come|pick|collect)|come (to )?(pick|collect)|pick(ed)? (them |it |the (cash|money|cards?) )?up|send (a )?(driver|runner|person)|kurier|coursier|mensajero|corriere)\b/iu,
  wire: /\b(wire( transfer)?|western union|moneygram|bank transfer|überweisung|virement|transferencia|bonifico)\b/iu,
};

/**
 * The markers found in what the parent reported, by rules. It can raise a flag
 * and never lower one: a parent who leaves out the gift cards does not make the
 * call safer, but the same words with a marker added never make it riskier
 * than the markers say.
 */
export function scamMarkers(said: readonly string[]): ScamMarker[] {
  const text = said.join(" ");
  return SCAM_MARKERS.filter((marker) => MARKER_RULES[marker].test(text));
}

/** True when any marker names a payment route that no family member needs. */
export const hasUnusualRoute = (markers: readonly ScamMarker[]): boolean => UNUSUAL_ROUTES.some((route) => markers.includes(route));

// ---------------------------------------------------------------------------
// What the parent said, as fields
// ---------------------------------------------------------------------------

/** The fields read from the parent's account. Each is `null` when the parent did not say it. */
export type AccountFields = {
  /** The name the caller gave: "Daniel". */
  readonly claimedName: string | null;
  /** How the caller said they are related: "your grandson". */
  readonly claimedRelationship: string | null;
  /** The amount asked for, in the parent's words. The figure is read by code, not by the model. */
  readonly amountText: string | null;
};

const clean = (text: string | null | undefined, max: number): string | null => {
  const value = (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return value === "" ? null : value;
};

export const cleanAccountFields = (fields: AccountFields): AccountFields => ({
  claimedName: clean(fields.claimedName, 80),
  claimedRelationship: clean(fields.claimedRelationship, 80),
  amountText: clean(fields.amountText, 120),
});

/**
 * The amount in the parent's words as cents: a figure in digits ("$2,000"), or
 * one written in words when those make exactly one number ("two thousand
 * dollars"). `null` when there is none or it is ambiguous, which the check then
 * treats as no amount to compare.
 */
export function accountCents(text: string | null, currency: string, language?: string): number | null {
  if (text === null) return null;
  const digits = /\d[\d,. ]*/u.exec(text);
  if (digits !== null) {
    const figure = digits[0]
      .trim()
      .replace(/[ ,](?=\d{3}\b)/g, "")
      .replace(/,/g, ".")
      .replace(/[. ]+$/, "");
    try {
      const cents = centsFromDecimal(figure, currency);
      return cents > 0 ? cents : null;
    } catch (error) {
      if (!(error instanceof InvalidDecimalError)) throw error;
    }
  }
  const readings = [...new Set(spokenNumbers(text, language).flatMap((each) => each.readings))];
  if (readings.length !== 1 || readings[0] === undefined) return null;
  try {
    const cents = centsFromDecimal(readings[0], currency);
    return cents > 0 ? cents : null;
  } catch (error) {
    if (error instanceof InvalidDecimalError) return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Trusted voices
// ---------------------------------------------------------------------------

/** A family member Kin may ask, with a phone number they confirmed by text. They need no Kin account. */
export type TrustedVoice = {
  readonly id: string;
  readonly name: string;
  readonly relationship: string;
  /** Other ways the family writes or says the name, such as the name in Hebrew or Arabic letters. */
  readonly aliases?: readonly string[];
};

/** Every name a person goes by: the one on the list, then the family's other spellings. */
const namesOf = (voice: TrustedVoice): readonly string[] => [voice.name, ...(voice.aliases ?? [])];

export type VoiceMatch = { readonly kind: "matched"; readonly voice: TrustedVoice } | { readonly kind: "unknown" };

const RELATION_GROUPS: readonly (readonly string[])[] = [
  ["grandson", "granddaughter", "grandchild", "grandkid", "enkel", "enkelin", "petit-fils", "petite-fille", "nieto", "nieta", "nipote"],
  ["son", "daughter", "child", "sohn", "tochter", "fils", "fille", "hijo", "hija", "figlio", "figlia"],
  ["nephew", "niece", "neffe", "nichte", "neveu", "nièce", "sobrino", "sobrina", "nipote"],
  ["brother", "sister", "sibling", "bruder", "schwester", "frère", "sœur", "hermano", "hermana", "fratello", "sorella"],
];

const WORD = /[\p{L}]+/gu;

function relationTokens(text: string): string[] {
  return (text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(WORD) ?? []).filter((word) => word.length > 1);
}

/** The relationship group a phrase belongs to ("my grandson" and "grandchild" agree), or `null`. */
function relationGroup(text: string): number | null {
  const words = relationTokens(text);
  const found = RELATION_GROUPS.findIndex((group) => group.some((member) => words.includes(member.normalize("NFKD").replace(/\p{M}/gu, ""))));
  return found === -1 ? null : found;
}

function firstNamesAgree(a: string, b: string): boolean {
  if (sameName(a, b)) return true;
  const left = relationTokens(a)[0];
  const right = relationTokens(b)[0];
  if (left === undefined || right === undefined) return false;
  // "Dan" for "Daniel": a nickname is a start of the name, at least three letters.
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  return short.length >= 3 && long.startsWith(short);
}

/**
 * Which trusted person the caller claimed to be. A name that agrees with one
 * (a nickname counts) picks them, unless the relationship plainly belongs to a
 * different kind of relative. A caller who gave no name is matched by
 * relationship only when exactly one trusted person fits. Anything else is
 * `unknown`: Kin never guesses between two people and never asks a person the
 * caller merely resembles.
 */
export function matchTrustedVoice(claim: Pick<AccountFields, "claimedName" | "claimedRelationship">, voices: readonly TrustedVoice[]): VoiceMatch {
  const group = claim.claimedRelationship === null ? null : relationGroup(claim.claimedRelationship);
  if (claim.claimedName !== null) {
    const named = voices.filter((voice) => namesOf(voice).some((name) => firstNamesAgree(name, claim.claimedName ?? "")));
    const fitting = group === null ? named : named.filter((voice) => relationGroup(voice.relationship) === group || relationGroup(voice.relationship) === null);
    const [only, ...others] = fitting;
    return only !== undefined && others.length === 0 ? { kind: "matched", voice: only } : { kind: "unknown" };
  }
  if (group === null) return { kind: "unknown" };
  const related = voices.filter((voice) => relationGroup(voice.relationship) === group);
  const [only, ...others] = related;
  return only !== undefined && others.length === 0 ? { kind: "matched", voice: only } : { kind: "unknown" };
}

// ---------------------------------------------------------------------------
// The check's states
// ---------------------------------------------------------------------------

/**
 * `opened`: written down, the real person not yet asked. `asked`: the text is
 * out (or, in a demo, shown). `confirmed`: they said it is them. `denied`: they
 * said it is not. `unanswered`: nobody answered within the window, or there was
 * nobody on the list to ask. `expired`: the link ran out with no answer.
 *
 * An answer counts whenever it arrives: from `opened` (the person tapped in the instant before the text was
 * recorded as sent), and late, a "not me" can follow an "unanswered" or even a
 * "confirmed" (a mistaken tap), because it only ever makes Kin more careful.
 * A "yes" never follows a "no".
 */
export const PRESENCE_TRANSITIONS = {
  opened: ["asked", "confirmed", "denied", "unanswered", "expired"],
  asked: ["confirmed", "denied", "unanswered", "expired"],
  unanswered: ["confirmed", "denied", "expired"],
  confirmed: ["denied"],
  denied: [],
  expired: [],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type PresenceState = keyof typeof PRESENCE_TRANSITIONS;
export const PRESENCE_STATES = Object.keys(PRESENCE_TRANSITIONS) as readonly PresenceState[];

export const presenceMoveAllowed = (from: PresenceState, to: PresenceState): boolean => (PRESENCE_TRANSITIONS[from] as readonly PresenceState[]).includes(to);

/** True while Kin is still waiting for the real person: money is held, and the parent is told to wait. */
export const presenceIsOpen = (state: PresenceState): boolean => state === "opened" || state === "asked";

/** The person's two answers. */
export type PresenceAnswer = "me" | "not_me";

export const ANSWER_STATE: Readonly<Record<PresenceAnswer, Extract<PresenceState, "confirmed" | "denied">>> = { me: "confirmed", not_me: "denied" };

// ---------------------------------------------------------------------------
// What Kin says
// ---------------------------------------------------------------------------

/**
 * Every sentence Kin may say to the parent about a check, and about the family code she asks a caller for. The words per
 * language live with the app that speaks them (`@kin/telephony`); the set is
 * closed here, and none holds an amount: only a name and the family's alert
 * contact are filled in, from the record.
 */
export const PRESENCE_REPLIES = ["checking", "denied", "unreachable", "confirmed", "unknown_person", "code_ok", "code_wrong"] as const;
export type PresenceReply = (typeof PRESENCE_REPLIES)[number];

export type PresenceReading = {
  readonly state: PresenceState;
  /** Whether the claimed person was found on the trusted list. */
  readonly matched: boolean;
  readonly markers: readonly ScamMarker[];
};

/** The one sentence the parent hears for a check in this state. */
export function presenceReply({ state, matched }: Pick<PresenceReading, "state" | "matched">): PresenceReply {
  if (!matched) return "unknown_person";
  switch (state) {
    case "opened":
    case "asked":
      return "checking";
    case "denied":
      return "denied";
    case "confirmed":
      return "confirmed";
    case "unanswered":
    case "expired":
      return "unreachable";
  }
}

/** The sentence for what a caller said when asked for the weekly family code. A right code is not proof, only a missing wrong one. */
export const codeReply = (matches: boolean): Extract<PresenceReply, "code_ok" | "code_wrong"> => (matches ? "code_ok" : "code_wrong");

export type PresenceRisk = "high" | "elevated" | "low";

/**
 * How worried the family should be, from the record alone: a "no" or a caller
 * nobody knows is high; an unusual way to pay, or an unreached person, is
 * elevated; a confirmed person with no markers is low. It is shown beside the
 * verdict and never changes it.
 */
export function presenceRisk({ state, matched, markers }: PresenceReading): PresenceRisk {
  if (!matched || state === "denied") return "high";
  if (hasUnusualRoute(markers) || state === "unanswered" || state === "expired" || markers.length >= 3) return "elevated";
  return state === "confirmed" && markers.length === 0 ? "low" : "elevated";
}

/**
 * The amount a check counts as stopped on the statement: what was asked for,
 * and only when the real person said it was not them. A check nobody answered
 * is not counted as money saved, because Kin cannot know.
 */
export const stoppedCents = (state: PresenceState, claimedCents: number | null): number => (state === "denied" && claimedCents !== null ? claimedCents : 0);

/** What a check holds outgoing money until, as a duration for the state it enters. `null` means the hold is released. */
export function holdHoursAfter(state: PresenceState): number | null {
  return state === "denied" ? PRESENCE_HOLD_HOURS : null;
}

// ---------------------------------------------------------------------------
// Reading the account without a model
// ---------------------------------------------------------------------------

const MONEY_WORDS = "dollars?|bucks|euros?|pounds?|usd|eur|gbp|francs?|dólares|dolares|franken|dollar|דולרים|דולר|אירו|יורו|שקלים|שקל|دولارا|دولار|يورو|جنيها|جنيه|ريال|دينار";
// A letter after the word means it is part of another word; `\b` cannot say so for Hebrew and Arabic, where every letter counts as a non-word character.
const AMOUNT_IN_TEXT = new RegExp(`(?:[$€£]\\s?\\d[\\d,. ]*\\d|[$€£]\\s?\\d|\\d[\\d,. ]*\\d\\s?(?:${MONEY_WORDS})(?![\\p{L}])|\\d\\s?(?:${MONEY_WORDS})(?![\\p{L}]))`, "iu");
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The same three fields, read by rules alone: the first trusted person whose
 * first name the parent says, the first relationship word, and the first amount
 * that looks like money. It is the fallback when the model is unreachable and the
 * cross-check of what it returned. A parent who names nobody on the list gets
 * `claimedName: null`, which `matchTrustedVoice` then resolves by relationship
 * only when exactly one trusted person fits.
 */
export function readAccountByRules(said: readonly string[], voices: readonly TrustedVoice[]): AccountFields {
  const text = said.join(" ");
  const plain = text.normalize("NFKD").replace(/\p{M}/gu, "");
  const named = voices
    .flatMap((voice) => {
      // The first name of each way the person is written; one found anywhere in the words names them.
      const found = namesOf(voice).flatMap((name) => {
        const first = relationTokens(name)[0];
        if (first === undefined || first.length < 3) return [];
        const hit = new RegExp(`(?<![\\p{L}])${escapeRegExp(first)}(?![\\p{L}])`, "iu").exec(plain);
        return hit === null ? [] : [hit.index];
      });
      return found.length === 0 ? [] : [{ voice, at: Math.min(...found) }];
    })
    .toSorted((a, b) => a.at - b.at)[0];
  const relation = RELATION_GROUPS.flat()
    .map((word) => ({ word, found: new RegExp(`(?<![\\p{L}])${escapeRegExp(word)}(?![\\p{L}])`, "iu").exec(text) }))
    .filter((hit) => hit.found !== null)
    .toSorted((a, b) => (a.found?.index ?? 0) - (b.found?.index ?? 0))[0];
  const amount = AMOUNT_IN_TEXT.exec(text);
  return cleanAccountFields({ claimedName: named?.voice.name ?? null, claimedRelationship: relation?.word ?? null, amountText: amount?.[0] ?? null });
}
