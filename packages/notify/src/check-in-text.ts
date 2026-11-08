/**
 * The text that gives a caregiver a link to check in to a shift. Fixed words in
 * the seven languages Kin speaks; the name, the time and the link come from the
 * record and are filled by code. Plain, no emoji, and the first line says whose
 * message it is. The list of languages repeats `@kin/telephony`'s office line on
 * purpose: this package depends on neither it nor the web app.
 *
 * Written for someone who reads it: the name, the time and the link are isolated
 * from the surrounding text with Unicode direction marks in Arabic and Hebrew, so
 * digits and Latin letters do not drift inside a right-to-left sentence. The
 * first line starts with the Latin word "Kin", so it also begins with a
 * right-to-left mark: without it a phone shows the whole line left to right,
 * with the closing full stop at the wrong end of the Arabic or Hebrew.
 */
export const TEXT_LOCALES = ["en", "fr", "de", "it", "es", "ar", "he"] as const;
export type TextLocale = (typeof TEXT_LOCALES)[number];

type CheckInWords = { readonly disclosure: string; readonly line: string };

export const CHECK_IN_WORDS: Readonly<Record<TextLocale, CheckInWords>> = {
  en: { disclosure: "Kin, your family’s care app.", line: "{name}, tap to check in to your shift at {time}: {url}" },
  fr: { disclosure: "Kin, l’application de soins de votre famille.", line: "{name}, appuyez pour pointer votre arrivée à la visite de {time} : {url}" },
  de: { disclosure: "Kin, die Pflege-App Ihrer Familie.", line: "{name}, tippen Sie, um sich für Ihren Einsatz um {time} einzustempeln: {url}" },
  it: { disclosure: "Kin, l’app di assistenza della tua famiglia.", line: "{name}, tocca per registrare il tuo arrivo al turno (ore {time}): {url}" },
  es: { disclosure: "Kin, la app de cuidados de su familia.", line: "{name}, toque para registrar su entrada en el turno de {time}: {url}" },
  ar: { disclosure: "Kin، تطبيق رعاية عائلتكم.", line: "{name}، اضغطوا لتسجيل حضوركم في مناوبتكم الساعة {time}: {url}" },
  he: { disclosure: "Kin, אפליקציית הטיפול של המשפחה שלכם.", line: "{name}, לחצו כדי לרשום כניסה למשמרת שלכם בשעה {time}: {url}" },
};

const RIGHT_TO_LEFT: ReadonlySet<TextLocale> = new Set(["ar", "he"]);
const RIGHT_TO_LEFT_MARK = "\u200F";

export type CheckInFacts = {
  readonly locale: TextLocale;
  /** The caregiver's first name, from the record. */
  readonly caregiverName: string;
  /** When the shift starts. */
  readonly startsAt: Date;
  /** The circle's time zone: a shift at 2:00 PM is 2:00 PM there, whatever the server's clock says. */
  readonly timezone: string;
  /** Where the caregiver checks in. HTTPS, no credentials. */
  readonly link: string;
};

/** The facts cannot make a message. Sending the same facts again cannot help. */
export class CheckInTextError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "CheckInTextError";
  }
}

const MAX_NAME_CHARS = 40;
const MAX_LINK_CHARS = 300;

const cleanName = (raw: string): string =>
  raw
    .replace(/[^\p{L}\p{M}\p{N} '’.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_CHARS)
    .trim();

function checkedLink(text: string): string {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new CheckInTextError("The check-in link is not an address");
  }
  if (text.length > MAX_LINK_CHARS || url.protocol !== "https:" || url.username !== "" || url.password !== "" || /\s/.test(text)) {
    throw new CheckInTextError("The check-in link must be a plain HTTPS address");
  }
  return url.toString();
}

function localTime(startsAt: Date, locale: TextLocale, timezone: string): string {
  if (Number.isNaN(startsAt.getTime())) throw new CheckInTextError("The shift has no start time");
  try {
    // Latin digits in every language: carriers and phones show them everywhere.
    return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(startsAt);
  } catch {
    throw new CheckInTextError("The circle's time zone is not one Kin knows");
  }
}

/** The whole text: one line that says who it is from, one line with the name, the time and the link. */
export function checkInText(facts: CheckInFacts): string {
  const name = cleanName(facts.caregiverName);
  if (name === "") throw new CheckInTextError("The caregiver's name is empty");
  const isolate = RIGHT_TO_LEFT.has(facts.locale) ? (text: string) => `⁨${text}⁩` : (text: string) => text;
  const values: Readonly<Record<string, string>> = {
    name: isolate(name),
    time: isolate(localTime(facts.startsAt, facts.locale, facts.timezone)),
    url: isolate(checkedLink(facts.link)),
  };
  const words = CHECK_IN_WORDS[facts.locale];
  const line = words.line.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`No value for {${key}} in the check-in text`);
    return value;
  });
  const disclosure = RIGHT_TO_LEFT.has(facts.locale) ? `${RIGHT_TO_LEFT_MARK}${words.disclosure}` : words.disclosure;
  return `${disclosure}\n${line}`;
}
