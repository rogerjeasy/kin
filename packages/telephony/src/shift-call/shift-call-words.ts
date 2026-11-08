import type { dayPart } from "@kin/domain";

import { fillTemplate } from "../fill-template.ts";
import type { OfficeLocale } from "../office-words.ts";

/**
 * What Kin says to the parent when a caregiver ends a visit and the family's
 * word is still missing. Fixed sentences in the seven languages of the office
 * line. Names, the part of the day and the family contact come from the record
 * and are filled by code; no model words any of it.
 *
 * Choices a reviewer should know:
 * - Nothing here assumes a gender. The caregiver is never "she" or "he":
 *   French, Italian, Spanish, Arabic and Hebrew would have to guess. Nor is
 *   the listener's: the parent may be a woman or a man, and a masculine or
 *   feminine "you" would be wrong for one of them. Arabic and Hebrew use the
 *   plural, respectful "you" that the screens use, and Hebrew the infinitive
 *   for the two ways to answer.
 * - The part of the day is a whole phrase per language ("ce matin", "heute
 *   Morgen"), because the preposition and article change with it.
 * - The family contact is optional and has its own sentence when absent, since
 *   "a la famiglia" would be wrong in Italian and "an die Familie" differs from
 *   "an Anna" only by what the blank holds.
 * - Spoken text carries no Unicode direction marks: a text-to-speech voice may
 *   read or drop them. The written message in `@kin/notify` isolates names.
 */
export type ShiftCallDayPart = ReturnType<typeof dayPart>;

export type ShiftCallWords = {
  readonly disclosure: string;
  readonly ifUnexpected: string;
  readonly visitEnding: string;
  readonly question: string;
  readonly when: Readonly<Record<ShiftCallDayPart, string>>;
  readonly reprompt: string;
  readonly thanks: string;
  readonly noted: string;
  readonly didNotHear: string;
  readonly leaveWith: string;
  readonly leaveWithFamily: string;
};

export const SHIFT_CALL_WORDS: Readonly<Record<OfficeLocale, ShiftCallWords>> = {
  en: {
    disclosure: "This is Kin, an automated assistant for your family.",
    ifUnexpected: "If you did not expect this call, you can hang up.",
    visitEnding: "{name} is finishing the visit.",
    question: "Was {name} with you {when}? Say yes, or press 1. Say no, or press 2.",
    when: { morning: "this morning", afternoon: "this afternoon", evening: "this evening" },
    reprompt: "Sorry, I did not catch that.",
    thanks: "Thank you. I have told {name} and the family.",
    noted: "Thank you for telling me.",
    didNotHear: "I did not hear a clear answer.",
    leaveWith: "I will leave this for {contact}.",
    leaveWithFamily: "I will leave this for the family.",
  },
  fr: {
    disclosure: "Bonjour, c’est Kin, un assistant automatique de votre famille.",
    ifUnexpected: "Si vous n’attendiez pas cet appel, vous pouvez raccrocher.",
    visitEnding: "La visite de {name} se termine.",
    question: "Avez-vous reçu la visite de {name} {when} ? Dites oui, ou appuyez sur 1. Dites non, ou appuyez sur 2.",
    when: { morning: "ce matin", afternoon: "cet après-midi", evening: "ce soir" },
    reprompt: "Excusez-moi, je n’ai pas compris.",
    thanks: "Merci. J’ai prévenu {name} et la famille.",
    noted: "Merci de me l’avoir dit.",
    didNotHear: "Je n’ai pas entendu de réponse claire.",
    leaveWith: "Je laisse cela à {contact}.",
    leaveWithFamily: "Je laisse cela à la famille.",
  },
  de: {
    disclosure: "Hier ist Kin, ein automatischer Assistent Ihrer Familie.",
    ifUnexpected: "Wenn Sie diesen Anruf nicht erwartet haben, können Sie auflegen.",
    visitEnding: "{name} beendet gerade den Besuch.",
    question: "War {name} {when} bei Ihnen? Sagen Sie Ja, oder drücken Sie die 1. Sagen Sie Nein, oder drücken Sie die 2.",
    when: { morning: "heute Morgen", afternoon: "heute Nachmittag", evening: "heute Abend" },
    reprompt: "Entschuldigung, das habe ich nicht verstanden.",
    thanks: "Danke. Ich habe {name} und die Familie informiert.",
    noted: "Danke für Ihre Antwort.",
    didNotHear: "Ich habe keine klare Antwort gehört.",
    leaveWith: "Ich gebe das an {contact} weiter.",
    leaveWithFamily: "Ich gebe das an die Familie weiter.",
  },
  it: {
    disclosure: "Sono Kin, un assistente automatico della sua famiglia.",
    ifUnexpected: "Se non si aspettava questa chiamata, può riagganciare.",
    visitEnding: "La visita di {name} sta finendo.",
    question: "Ha ricevuto la visita di {name} {when}? Dica sì, oppure prema 1. Dica no, oppure prema 2.",
    when: { morning: "stamattina", afternoon: "oggi pomeriggio", evening: "stasera" },
    reprompt: "Mi scusi, non ho capito.",
    thanks: "Grazie. Ho avvisato {name} e la famiglia.",
    noted: "Grazie per avermelo detto.",
    didNotHear: "Non ho sentito una risposta chiara.",
    leaveWith: "Lo lascio a {contact}.",
    leaveWithFamily: "Lo lascio alla famiglia.",
  },
  es: {
    disclosure: "Soy Kin, un asistente automático de su familia.",
    ifUnexpected: "Si no esperaba esta llamada, puede colgar.",
    visitEnding: "La visita de {name} está terminando.",
    question: "¿Ha recibido la visita de {name} {when}? Diga sí, o pulse 1. Diga no, o pulse 2.",
    when: { morning: "esta mañana", afternoon: "esta tarde", evening: "esta noche" },
    reprompt: "Perdone, no he entendido.",
    thanks: "Gracias. He avisado a {name} y a la familia.",
    noted: "Gracias por decírmelo.",
    didNotHear: "No he oído una respuesta clara.",
    leaveWith: "Se lo dejo a {contact}.",
    leaveWithFamily: "Se lo dejo a la familia.",
  },
  ar: {
    disclosure: "معكم Kin، مساعد آلي لعائلتكم.",
    ifUnexpected: "إذا لم تكونوا تتوقعون هذه المكالمة، يمكنكم إغلاق الخط.",
    visitEnding: "تقترب زيارة {name} من نهايتها.",
    question: "هل تمّت زيارة {name} لكم {when}؟ قولوا نعم، أو اضغطوا 1. قولوا لا، أو اضغطوا 2.",
    when: { morning: "صباح اليوم", afternoon: "بعد ظهر اليوم", evening: "مساء اليوم" },
    reprompt: "عذراً، لم أفهم.",
    thanks: "شكراً. أبلغت {name} والعائلة.",
    noted: "شكراً لإخباري.",
    didNotHear: "لم أسمع إجابة واضحة.",
    leaveWith: "سأترك الأمر إلى {contact}.",
    leaveWithFamily: "سأترك الأمر للعائلة.",
  },
  he: {
    disclosure: "כאן Kin, עוזר אוטומטי של המשפחה שלכם.",
    ifUnexpected: "אם לא ציפיתם לשיחה הזו, אפשר לנתק.",
    visitEnding: "הביקור של {name} מסתיים.",
    question: "האם היה אצלכם ביקור של {name} {when}? אפשר לומר כן או ללחוץ 1. אפשר לומר לא או ללחוץ 2.",
    when: { morning: "הבוקר", afternoon: "אחר הצהריים", evening: "הערב" },
    reprompt: "סליחה, לא הבנתי.",
    thanks: "תודה. עדכנתי את {name} ואת המשפחה.",
    noted: "תודה על התשובה.",
    didNotHear: "לא שמעתי תשובה ברורה.",
    leaveWith: "אשאיר את זה בידי {contact}.",
    leaveWithFamily: "אשאיר את זה בידי המשפחה.",
  },
};

const MAX_NAME_CHARS = 40;

/**
 * A first name or contact name as it is safe to speak: letters, marks,
 * digits, spaces and the few marks a name holds, nothing else. Control and
 * direction characters, angle brackets and the like are dropped.
 */
export function speakableName(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{M}\p{N} '’.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_CHARS)
    .trim();
}

/** A name that is empty once cleaned: a sentence cannot be spoken about nobody. */
export class ShiftCallWordsError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "ShiftCallWordsError";
  }
}

/** What the record supplies to the sentences. Both names are data, never instructions. */
export type ShiftCallFacts = {
  readonly locale: OfficeLocale;
  /** The caregiver's first name, from the record. */
  readonly caregiverName: string;
  /** The part of the day the visit began in, on the circle's clock (`dayPart` in the domain). */
  readonly dayPart: ShiftCallDayPart;
  /** The family member who will see the result, or `null` for "the family". */
  readonly contactName: string | null;
};

export type ShiftCallSentences = {
  /** The opening, said once: who Kin is and that the call can be hung up. */
  readonly opening: readonly string[];
  /** The question with its two ways to answer. */
  readonly question: string;
  readonly reprompt: string;
  readonly confirmed: readonly string[];
  readonly declined: readonly string[];
  readonly unclear: readonly string[];
};

/** Every sentence of the call, filled from the record. */
export function shiftCallSentences(facts: ShiftCallFacts): ShiftCallSentences {
  const words = SHIFT_CALL_WORDS[facts.locale];
  const name = speakableName(facts.caregiverName);
  if (name === "") throw new ShiftCallWordsError("The caregiver's name is empty");
  const contact = facts.contactName === null ? "" : speakableName(facts.contactName);
  const leave = contact === "" ? words.leaveWithFamily : fillTemplate(words.leaveWith, { contact });
  return {
    opening: [words.disclosure, words.ifUnexpected, fillTemplate(words.visitEnding, { name })],
    question: fillTemplate(words.question, { name, when: words.when[facts.dayPart] }),
    reprompt: words.reprompt,
    confirmed: [fillTemplate(words.thanks, { name })],
    declined: [words.noted, leave],
    unclear: [words.didNotHear, leave],
  };
}
