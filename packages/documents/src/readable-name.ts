// Words a name keeps in capitals: company forms and well-known acronyms.
const ACRONYMS = new Set(["LLC", "LLP", "LP", "PLC", "USA", "US", "UK", "IRS", "DMV", "HVAC", "PO", "PG&E", "AT&T"]);
// Small words that stay lower case inside a name, as "City of Springfield".
const SMALL_WORDS = new Set(["of", "the", "and", "for", "at", "in", "on", "de", "la", "du", "des", "von", "van", "der", "di", "del", "el"]);
const FORMS: Readonly<Record<string, string>> = { GMBH: "GmbH", INC: "Inc", LTD: "Ltd", CO: "Co", CORP: "Corp" };

const hasVowel = (word: string) => /[AEIOUY]/u.test(word);
const isAcronym = (word: string) => ACRONYMS.has(word) || word.includes("&") || (word.length <= 4 && !hasVowel(word));

function titleWord(word: string): string {
  return word.toLowerCase().replaceAll(/(^|[-'’/(])(\p{L})/gu, (_match, lead: string, letter: string) => lead + letter.toUpperCase());
}

function readableWord(word: string, first: boolean): string {
  const bare = word.replaceAll(/[.,;:()]/gu, "");
  const form = FORMS[bare];
  if (form !== undefined) return word.replace(bare, form);
  if (isAcronym(bare)) return word;
  if (!first && SMALL_WORDS.has(bare.toLowerCase())) return word.toLowerCase();
  return titleWord(word);
}

/**
 * A name as a person would write it. A name read from a letter is often
 * printed in capitals ("CITY OF SPRINGFIELD WATER DEPARTMENT"), which is hard
 * to read aloud and on a screen. Only a name written wholly in capitals is
 * changed; one with any lower-case letter, and any script without case, is
 * returned as it is. This is for display: evidence is always matched against
 * the source ignoring case.
 */
export function readableName(name: string): string {
  if (name !== name.toUpperCase() || name === name.toLowerCase()) return name;
  return name
    .split(/(\s+)/u)
    .map((part, index) => (/^\s*$/u.test(part) ? part : readableWord(part, index === 0)))
    .join("");
}
