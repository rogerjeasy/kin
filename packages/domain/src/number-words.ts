/**
 * Cardinal numbers written in words, read by value, for the number guard
 * (docs/architecture.md section 9.6). The guard compares digits; this closes
 * the other way a model can state an amount: "sixty-four dollars",
 * "soixante-quatre", "vierundsechzig", "sessantaquattro", "sesenta y cuatro",
 * "أربعة وستون", "שישים וארבע".
 *
 * The text's language is not known, so one lexicon holds the cardinals of
 * English, French, German, Italian, Spanish, Arabic and Hebrew. A run of
 * number words ("vingt et un", "dreihunderteinundzwanzig") is parsed to its
 * value with a small grammar. The reading fails closed: a run the grammar
 * cannot value has no reading, so the caller refuses it.
 *
 * Not numbers: ordinals ("seventh", "premier"), and the lone articles that
 * share a number's spelling ("one", "un", "une", "ein", "uno", "אחד",
 * "واحد"). An article beside a magnitude word is part of the number.
 */

type Kind = "zero" | "unit" | "ten" | "teen" | "tens" | "hundred" | "hundreds" | "scale";

type Atom = {
  readonly kind: Kind;
  readonly value: number;
  /** A word that is also an article ("un"); a run of nothing else is not a number. */
  readonly one?: true;
  /** Only meaningful after a count ("millions", "מאות"). */
  readonly plural?: true;
  /** Hebrew and Arabic "ten" after a unit: "שלושה עשר" is thirteen. */
  readonly suffix?: true;
  /** French irregulars: soixante and quatre-vingt take 10..16 after them, and dix takes 7..9. */
  readonly french?: true;
  /** A dual or fixed multiple: "ألفان" is two thousand. */
  readonly multiple?: number;
  /** "cent"/"cents": a hundred in French, a coin in English. */
  readonly cent?: true;
  /** Words whose value differs between languages ("billion"): never accepted. */
  readonly ambiguous?: true;
  readonly word: string;
};

type Entry = Omit<Atom, "word" | "kind" | "value">;
type Lexicon = Map<string, Atom>;

function define(lexicon: Lexicon, kind: Kind, value: number, words: string, extra: Entry = {}): void {
  for (const word of words.split(" ")) lexicon.set(normalise(word), { kind, value, word, ...extra });
}

/** Lower case, Arabic and Hebrew marks removed, Arabic letter variants folded. Latin accents are kept: "très" is not "tres". */
function normalise(word: string): string {
  return word
    .normalize("NFC")
    .toLowerCase()
    .replaceAll(/[֑-ׇً-ٰٟـ]/gu, "")
    .replaceAll(/[أإآٱ]/gu, "ا")
    .replaceAll("ة", "ه")
    .replaceAll("ى", "ي");
}

const ONE = { one: true } as const;
const PLURAL = { plural: true } as const;
const SUFFIX = { suffix: true } as const;
const FRENCH = { french: true } as const;

function english(): Lexicon {
  const l: Lexicon = new Map();
  define(l, "zero", 0, "zero");
  define(l, "unit", 1, "one", ONE);
  for (const [value, words] of [[2, "two"], [3, "three"], [4, "four"], [5, "five"], [6, "six"], [7, "seven"], [8, "eight"], [9, "nine"]] as const) define(l, "unit", value, words);
  define(l, "ten", 10, "ten");
  for (const [value, words] of [[11, "eleven"], [12, "twelve"], [13, "thirteen"], [14, "fourteen"], [15, "fifteen"], [16, "sixteen"], [17, "seventeen"], [18, "eighteen"], [19, "nineteen"]] as const) define(l, "teen", value, words);
  for (const [value, words] of [[20, "twenty"], [30, "thirty"], [40, "forty fourty"], [50, "fifty"], [60, "sixty"], [70, "seventy"], [80, "eighty"], [90, "ninety"]] as const) define(l, "tens", value, words);
  define(l, "hundred", 100, "hundred");
  define(l, "scale", 1000, "thousand");
  define(l, "scale", 1_000_000, "million");
  define(l, "scale", 1_000_000_000, "billion billions trillion", { ambiguous: true });
  return l;
}

function french(): Lexicon {
  const l: Lexicon = new Map();
  define(l, "zero", 0, "zéro zero");
  define(l, "unit", 1, "un une", ONE);
  for (const [value, words] of [[2, "deux"], [3, "trois"], [4, "quatre"], [5, "cinq"], [6, "six"], [7, "sept"], [8, "huit"], [9, "neuf"]] as const) define(l, "unit", value, words);
  define(l, "ten", 10, "dix", FRENCH);
  for (const [value, words] of [[11, "onze"], [12, "douze"], [13, "treize"], [14, "quatorze"], [15, "quinze"], [16, "seize"]] as const) define(l, "teen", value, words);
  for (const [value, words] of [[20, "vingt vingts"], [30, "trente"], [40, "quarante"], [50, "cinquante"], [70, "septante"], [80, "huitante octante"], [90, "nonante"]] as const) define(l, "tens", value, words);
  define(l, "tens", 60, "soixante", FRENCH);
  define(l, "hundred", 100, "cent", { cent: true });
  define(l, "hundred", 100, "cents", { cent: true, plural: true });
  define(l, "scale", 1000, "mille");
  define(l, "scale", 1_000_000, "million", {});
  define(l, "scale", 1_000_000, "millions", PLURAL);
  define(l, "scale", 1_000_000_000, "milliard", {});
  define(l, "scale", 1_000_000_000, "milliards", PLURAL);
  define(l, "scale", 1_000_000_000, "billion billions", { ambiguous: true });
  return l;
}

function german(): Lexicon {
  const l: Lexicon = new Map();
  define(l, "zero", 0, "null");
  define(l, "unit", 1, "ein eine einen einem einer eines eins", ONE);
  for (const [value, words] of [[2, "zwei zwo"], [3, "drei"], [4, "vier"], [5, "fünf fuenf funf"], [6, "sechs"], [7, "sieben"], [8, "acht"], [9, "neun"]] as const) define(l, "unit", value, words);
  define(l, "ten", 10, "zehn");
  for (const [value, words] of [[11, "elf"], [12, "zwölf zwoelf zwolf"], [13, "dreizehn"], [14, "vierzehn"], [15, "fünfzehn fuenfzehn funfzehn"], [16, "sechzehn"], [17, "siebzehn"], [18, "achtzehn"], [19, "neunzehn"]] as const) define(l, "teen", value, words);
  for (const [value, words] of [[20, "zwanzig"], [30, "dreißig dreissig"], [40, "vierzig"], [50, "fünfzig fuenfzig funfzig"], [60, "sechzig"], [70, "siebzig"], [80, "achtzig"], [90, "neunzig"]] as const) define(l, "tens", value, words);
  define(l, "hundred", 100, "hundert");
  define(l, "scale", 1000, "tausend");
  define(l, "scale", 1_000_000, "million", {});
  define(l, "scale", 1_000_000, "millionen", PLURAL);
  define(l, "scale", 1_000_000_000, "milliarde", {});
  define(l, "scale", 1_000_000_000, "milliarden", PLURAL);
  define(l, "scale", 1_000_000_000, "billion billionen", { ambiguous: true });
  return l;
}

function italian(): Lexicon {
  const l: Lexicon = new Map();
  define(l, "zero", 0, "zero");
  define(l, "unit", 1, "un uno una", ONE);
  for (const [value, words] of [[2, "due"], [3, "tre tré"], [4, "quattro"], [5, "cinque"], [6, "sei"], [7, "sette"], [8, "otto"], [9, "nove"]] as const) define(l, "unit", value, words);
  define(l, "ten", 10, "dieci");
  for (const [value, words] of [[11, "undici"], [12, "dodici"], [13, "tredici"], [14, "quattordici"], [15, "quindici"], [16, "sedici"], [17, "diciassette"], [18, "diciotto"], [19, "diciannove"]] as const) define(l, "teen", value, words);
  for (const [value, words] of [[20, "venti"], [30, "trenta"], [40, "quaranta"], [50, "cinquanta"], [60, "sessanta"], [70, "settanta"], [80, "ottanta"], [90, "novanta"]] as const) define(l, "tens", value, words);
  define(l, "hundred", 100, "cento");
  define(l, "scale", 1000, "mille");
  define(l, "scale", 1000, "mila", PLURAL);
  define(l, "scale", 1_000_000, "milione", {});
  define(l, "scale", 1_000_000, "milioni", PLURAL);
  define(l, "scale", 1_000_000_000, "miliardo", {});
  define(l, "scale", 1_000_000_000, "miliardi", PLURAL);
  return l;
}

/** The tens and hundred lose their last vowel before "uno" or "otto" ("ventuno", "centotto"). */
function italianStems(): Lexicon {
  const l = italian();
  for (const [value, words] of [[20, "vent"], [30, "trent"], [40, "quarant"], [50, "cinquant"], [60, "sessant"], [70, "settant"], [80, "ottant"], [90, "novant"]] as const) define(l, "tens", value, words);
  define(l, "hundred", 100, "cent");
  return l;
}

function spanish(): Lexicon {
  const l: Lexicon = new Map();
  define(l, "zero", 0, "cero");
  define(l, "unit", 1, "un uno una", ONE);
  for (const [value, words] of [[2, "dos"], [3, "tres"], [4, "cuatro"], [5, "cinco"], [6, "seis"], [7, "siete"], [8, "ocho"], [9, "nueve"]] as const) define(l, "unit", value, words);
  define(l, "ten", 10, "diez");
  for (const [value, words] of [[11, "once"], [12, "doce"], [13, "trece"], [14, "catorce"], [15, "quince"], [16, "dieciséis dieciseis"], [17, "diecisiete"], [18, "dieciocho"], [19, "diecinueve"]] as const) define(l, "teen", value, words);
  for (const [value, words] of [[21, "veintiuno veintiún veintiun veintiuna"], [22, "veintidós veintidos"], [23, "veintitrés veintitres"], [24, "veinticuatro"], [25, "veinticinco"], [26, "veintiséis veintiseis"], [27, "veintisiete"], [28, "veintiocho"], [29, "veintinueve"]] as const) define(l, "teen", value, words);
  for (const [value, words] of [[20, "veinte"], [30, "treinta"], [40, "cuarenta"], [50, "cincuenta"], [60, "sesenta"], [70, "setenta"], [80, "ochenta"], [90, "noventa"]] as const) define(l, "tens", value, words);
  define(l, "hundred", 100, "cien ciento");
  for (const [value, words] of [[200, "doscientos doscientas"], [300, "trescientos trescientas"], [400, "cuatrocientos cuatrocientas"], [500, "quinientos quinientas"], [600, "seiscientos seiscientas"], [700, "setecientos setecientas"], [800, "ochocientos ochocientas"], [900, "novecientos novecientas"]] as const) define(l, "hundreds", value, words);
  define(l, "scale", 1000, "mil");
  define(l, "scale", 1_000_000, "millón millon", {});
  define(l, "scale", 1_000_000, "millones", PLURAL);
  define(l, "scale", 1_000_000_000, "billón billon billones", { ambiguous: true });
  return l;
}

function arabic(): Lexicon {
  const l: Lexicon = new Map();
  define(l, "zero", 0, "صفر");
  define(l, "unit", 1, "واحد واحدة واحده", ONE);
  define(l, "unit", 1, "أحد إحدى", ONE);
  for (const [value, words] of [
    [2, "اثنان اثنين اثنتان اثنتين اثنا اثني اثنتا اثنتي اتنين"],
    [3, "ثلاث ثلاثة"],
    [4, "أربع أربعة"],
    [5, "خمس خمسة"],
    [6, "ست ستة"],
    [7, "سبع سبعة"],
    [8, "ثمان ثماني ثمانية ثمانٍ"],
    [9, "تسع تسعة"],
  ] as const) define(l, "unit", value, words);
  define(l, "ten", 10, "عشر عشرة", SUFFIX);
  for (const [value, words] of [[20, "عشرون عشرين"], [30, "ثلاثون ثلاثين"], [40, "أربعون أربعين"], [50, "خمسون خمسين"], [60, "ستون ستين"], [70, "سبعون سبعين"], [80, "ثمانون ثمانين"], [90, "تسعون تسعين"]] as const) define(l, "tens", value, words);
  define(l, "hundred", 100, "مئة مائة مئه مائه");
  for (const [value, stems] of [[300, "ثلاث"], [400, "أربع"], [500, "خمس"], [600, "ست"], [700, "سبع"], [800, "ثمان ثماني"], [900, "تسع"]] as const) {
    for (const stem of stems.split(" ")) define(l, "hundreds", value, ["مئة", "مائة", "مئه", "مائه"].map((hundred) => `${stem}${hundred}`).join(" "));
  }
  define(l, "hundreds", 200, "مئتان مئتين مائتان مائتين");
  define(l, "scale", 1000, "ألف");
  define(l, "scale", 1000, "ألفان ألفين", { multiple: 2 });
  define(l, "scale", 1000, "آلاف", PLURAL);
  define(l, "scale", 1_000_000, "مليون");
  define(l, "scale", 1_000_000, "مليونان مليونين", { multiple: 2 });
  define(l, "scale", 1_000_000, "ملايين", PLURAL);
  define(l, "scale", 1_000_000_000, "مليار");
  define(l, "scale", 1_000_000_000, "ملياران مليارين", { multiple: 2 });
  define(l, "scale", 1_000_000_000, "مليارات", PLURAL);
  return l;
}

function hebrew(): Lexicon {
  const l: Lexicon = new Map();
  define(l, "zero", 0, "אפס");
  define(l, "unit", 1, "אחד אחת", ONE);
  for (const [value, words] of [
    [2, "שניים שנים שתיים שתים שני שתי"],
    [3, "שלושה שלוש שלושת"],
    [4, "ארבעה ארבע ארבעת"],
    [5, "חמישה חמש חמשת"],
    [6, "שישה שש ששת"],
    [7, "שבעה שבע שבעת"],
    [8, "שמונה שמונת"],
    [9, "תשעה תשע תשעת"],
  ] as const) define(l, "unit", value, words);
  define(l, "ten", 10, "עשרה עשר עשרת", SUFFIX);
  for (const [value, words] of [[20, "עשרים"], [30, "שלושים"], [40, "ארבעים"], [50, "חמישים"], [60, "שישים"], [70, "שבעים"], [80, "שמונים"], [90, "תשעים"]] as const) define(l, "tens", value, words);
  define(l, "hundred", 100, "מאה");
  define(l, "hundred", 100, "מאות", PLURAL);
  define(l, "hundreds", 200, "מאתיים");
  define(l, "scale", 1000, "אלף");
  define(l, "scale", 1000, "אלפיים", { multiple: 2 });
  define(l, "scale", 1000, "אלפים", PLURAL);
  define(l, "scale", 1_000_000, "מיליון");
  define(l, "scale", 1_000_000, "מיליונים", PLURAL);
  define(l, "scale", 1_000_000_000, "מיליארד");
  define(l, "scale", 1_000_000_000, "מיליארדים", PLURAL);
  return l;
}

const ALL = [english(), french(), german(), italian(), spanish(), arabic(), hebrew()];
const DIRECT: Lexicon = new Map(ALL.flatMap((lexicon) => [...lexicon]));
// German and Italian write a compound as one word: "vierundsechzig", "centoventi", "duemilacinquecento".
const COMPOUND_PARTS: readonly Lexicon[] = [german(), italianStems()].map((lexicon) => new Map([...lexicon].filter(([word]) => word.length >= 2)));
const JOINS = new Set(["and", "et", "und", "e", "y"]);
// A unit before its tens ("vierundsechzig", "أربعة وستون", "ארבעה ועשרים") needs "und", "و" or "ו" between.
const UNIT_FIRST_JOINS = new Set(["und", "و", "ו"]);
const PREFIXES = new Set(["و", "ب", "ل", "ك", "ف", "ו", "ב", "ל", "כ", "מ", "ה", "ש"]);

/**
 * The longest letter-only word read as a compound. The longest real number a
 * guarded text can hold is a German 999,999,999 (about 90 letters); a longer
 * word is refused outright rather than searched, so no input costs more than
 * this squared.
 */
const MAX_WORD_LENGTH = 100;
/** Text longer than this, or with more tokens than the cap, is refused whole: no real sentence of Kin's is near it. */
const MAX_TEXT_LENGTH = 2000;
const MAX_TOKENS = 1000;

type Split = { atoms: Atom[]; joins: string[] };

/**
 * One atom per part when the whole word is a compound of the lexicon's words,
 * or null. The best split of the rest of the word depends only on where it
 * starts, so each start is solved once: O(n^2) however many atoms overlap.
 */
function split(word: string, lexicon: Lexicon): Split | null {
  const memo = new Map<number, Split | null>();
  const from = (start: number): Split | null => {
    if (start === word.length) return { atoms: [], joins: [] };
    const known = memo.get(start);
    if (known !== undefined) return known;
    let result: Split | null = null;
    for (let end = word.length; end - start >= 2; end -= 1) {
      const head = word.slice(start, end);
      const atom = lexicon.get(head);
      if (atom === undefined && !(head === "und" && end < word.length)) continue;
      const tail = from(end);
      if (tail === null) continue;
      if (atom === undefined) {
        if (tail.atoms.length === 0) continue;
        result = { atoms: tail.atoms, joins: ["und", ...tail.joins.slice(1)] };
      } else {
        result = { atoms: [atom, ...tail.atoms], joins: ["", ...tail.joins] };
      }
      break;
    }
    memo.set(start, result);
    return result;
  };
  return from(0);
}

/** The languages whose ordinary words are told apart from number words. */
const LANGUAGE_CODES: Readonly<Record<string, string>> = {
  en: "en", english: "en", fr: "fr", french: "fr", de: "de", german: "de", it: "it", italian: "it", es: "es", spanish: "es", ar: "ar", arabic: "ar", he: "he", hebrew: "he",
};

/** The code of a language given as an ISO code or its English name, or undefined when it is unknown. */
export function languageCode(language: string | undefined): string | undefined {
  return language === undefined ? undefined : LANGUAGE_CODES[language.trim().toLowerCase()];
}

// Words that spell a number in one of the other lexicons but are ordinary words of the language: "due" (English,
// French) is Italian two, "once" (English, French) is Spanish eleven, "sei" (German) is Italian six. Each language
// drops only those; its own numbers and every other language's number words are still read, so a model that
// switches language mid-sentence is caught. Arabic and Hebrew have none: an unsure word stays a number.
const ORDINARY: Readonly<Record<string, ReadonlySet<string>>> = {
  en: new Set(["due", "once"]),
  fr: new Set(["due"]),
  de: new Set(["sei"]),
  es: new Set(["ten"]),
};

// Italian "sei" is six and "you are": it is the verb before these words.
const SEI_VERB_NEXT = new Set(["al", "alla", "a", "in", "qui", "un", "una", "uno", "il", "la", "lo", "nel", "nella", "stato", "stata", "sempre", "pronto", "pronta", "sicuro", "sicura", "già", "gia", "tu", "così", "cosi", "ancora", "solo", "sola", "libero", "libera"]);

type Resolved = { readonly atoms: readonly Atom[]; readonly joins: readonly string[] } | { readonly join: string } | { readonly tooLong: true } | null;

function resolve(word: string, language: string | undefined): Resolved {
  if (language !== undefined && ORDINARY[language]?.has(word)) return null;
  const direct = DIRECT.get(word);
  if (direct !== undefined) return { atoms: [direct], joins: [""] };
  if (JOINS.has(word)) return { join: word };
  if (word === "و" || word === "ו") return { join: word };
  if (word.length > MAX_WORD_LENGTH) return { tooLong: true };
  for (const lexicon of COMPOUND_PARTS) {
    if (word.length < 4) break;
    const parts = split(word, lexicon);
    if (parts !== null && parts.atoms.length > 0) return { atoms: parts.atoms, joins: parts.joins };
  }
  // Arabic and Hebrew attach "and", "in", "to" and "the" as a first letter: "وستون", "ושישים", "לשלושה".
  const letters = [...word];
  for (let cut = 1; cut <= 2 && cut < letters.length - 1; cut += 1) {
    const prefix = letters.slice(0, cut);
    if (!prefix.every((letter) => PREFIXES.has(letter))) break;
    const atom = DIRECT.get(letters.slice(cut).join(""));
    if (atom !== undefined && /[֐-׿؀-ۿ]/u.test(atom.word)) return { atoms: [atom], joins: [prefix[0] === "و" || prefix[0] === "ו" ? prefix[0] : ""] };
  }
  return null;
}

type Last = "" | "unit" | "ten" | "ten-french" | "complete" | "tens" | "tens-french" | "hundred" | "scale";

type State = {
  readonly total: number;
  readonly lastScale: number;
  readonly hundreds: number;
  readonly below: number;
  readonly last: Last;
  readonly lastWord: string;
  readonly atoms: number;
  readonly onlyArticles: boolean;
  /** Set when the run ended in "cent(s)": the value without it, or null when that reading is only an article. */
  readonly withoutCent: string | null | undefined;
};

const EMPTY: State = { total: 0, lastScale: Number.POSITIVE_INFINITY, hundreds: 0, below: 0, last: "", lastWord: "", atoms: 0, onlyArticles: true, withoutCent: undefined };

const valueOf = (state: State) => state.total + state.hundreds + state.below;

/** Adds one word to a run, or null when no number reads that way. */
function step(state: State, atom: Atom, join: string): State | null {
  if (atom.ambiguous === true) return null;
  const base = { ...state, atoms: state.atoms + 1, onlyArticles: state.onlyArticles && atom.one === true, lastWord: atom.word, withoutCent: undefined };
  const below = state.below;
  switch (atom.kind) {
    case "zero":
      return state.atoms === 0 ? { ...base, last: "complete" } : null;
    case "unit": {
      if (below === 0 && state.last !== "complete") return { ...base, below: atom.value, last: "unit" };
      if (state.last === "tens" || state.last === "tens-french") return { ...base, below: below + atom.value, last: "complete" };
      if (state.last === "ten-french" && atom.value >= 7) return { ...base, below: below + atom.value, last: "complete" };
      return null;
    }
    case "ten": {
      if (below === 0) return { ...base, below: 10, last: atom.french === true ? "ten-french" : "ten" };
      if (state.last === "unit" && atom.suffix === true) return { ...base, below: below + 10, last: "complete" };
      if (state.last === "tens-french") return { ...base, below: below + 10, last: "ten-french" };
      return null;
    }
    case "teen": {
      if (below === 0) return { ...base, below: atom.value, last: "complete" };
      if (state.last === "tens-french" && atom.value <= 16) return { ...base, below: below + atom.value, last: "complete" };
      return null;
    }
    case "tens": {
      // "quatre-vingt": four twenties.
      if (state.last === "unit" && below === 4 && state.lastWord === "quatre" && atom.value === 20) return { ...base, below: 80, last: "tens-french" };
      if (below === 0) return { ...base, below: atom.value, last: atom.french === true ? "tens-french" : "tens" };
      if (state.last === "unit" && UNIT_FIRST_JOINS.has(join)) return { ...base, below: below + atom.value, last: "complete" };
      return null;
    }
    case "hundred":
      return state.hundreds === 0 && below <= 9 ? { ...base, hundreds: (below || 1) * 100, below: 0, last: "hundred" } : null;
    case "hundreds":
      return state.hundreds === 0 && below === 0 ? { ...base, hundreds: atom.value, last: "hundred" } : null;
    case "scale": {
      const count = state.hundreds + below;
      const multiplier = atom.multiple ?? 1;
      if (count === 0 && state.total > 0 && atom.value > state.lastScale && multiplier === 1) return { ...base, total: state.total * atom.value, lastScale: atom.value, last: "scale" };
      if (count === 0 && atom.plural === true) return null;
      if (atom.value >= state.lastScale) return null;
      return { ...base, total: state.total + (count || 1) * atom.value * multiplier, lastScale: atom.value, hundreds: 0, below: 0, last: "scale" };
    }
  }
}

/** A number written in words: every value it can have, or none when it cannot be read. */
export type SpokenNumber = {
  /** The words as written. */
  readonly words: string;
  /** The values it may mean, as plain integer strings. Empty when the words do not make a number. */
  readonly readings: readonly string[];
};

type Token = { readonly word: string } | "digit" | "break";

// Format characters (zero-width spaces and joiners, bidi controls, soft hyphen, tags) and variation selectors are
// invisible: they could split a number word or hide a magnitude word from the reader of this code. The few marks
// Kin itself writes around an amount in right-to-left text are skipped like a space; every other one is a break.
const TRANSPARENT = "\\u061C\\u200E\\u200F\\u2068\\u2069";
const VARIATION = "\\uFE00-\\uFE0F\\u180B-\\u180D\\u{E0100}-\\u{E01EF}";
// The directional marks stand around a whole amount, never between two letters or digits, where they would cut a
// word or a number in two. Every other default-ignorable character (joiners, fillers, tags) is hidden, and so is a
// combining mark on a Latin letter: text is NFC first, so what remains is a mark with no precomposed letter, which
// would make "sixty" read as an unknown word.
const HIDDEN_SOURCE = `(?![${TRANSPARENT}])[\\p{Cf}\\p{Default_Ignorable_Code_Point}${VARIATION}]|(?<=[\\p{L}\\p{M}\\p{N}])[${TRANSPARENT}](?=[\\p{L}\\p{M}\\p{N}])|(?<=\\p{Script=Latin})\\p{M}`;
const HIDDEN = new RegExp(HIDDEN_SOURCE, "u");
const HIDDEN_ALL = new RegExp(HIDDEN_SOURCE, "gu");
const TOKEN = new RegExp(`(?:(?![${VARIATION}])[\\p{L}\\p{M}])+|\\p{N}+|[^\\p{L}\\p{M}\\p{N}\\s\\-\\u2010\\u2011\\u2012\\u2013\\u2014\\u05BE'\\u2019${TRANSPARENT}]`, "gu");

/**
 * Whether the text holds an invisible character that could hide or split a
 * number word: any format character or variation selector other than the
 * directional marks Kin writes around amounts. Wording that has one is refused.
 */
export function hasHiddenCharacters(text: string): boolean {
  return HIDDEN.test(text.normalize("NFC"));
}

function tokens(text: string): Token[] {
  const found = text.normalize("NFC").toLowerCase().replaceAll(HIDDEN_ALL, " | ").matchAll(TOKEN);
  return [...found].map((match): Token => (/^[\p{L}\p{M}]/u.test(match[0]) ? { word: normalise(match[0]) } : /^\p{N}/u.test(match[0]) ? "digit" : "break"));
}

/**
 * Every cardinal number written in words in the text, with its value. An
 * article beside no magnitude word ("une facture", "ein Betrag") is not one.
 * "cent" and "cents" are a hundred in French and a coin in English: a run
 * ending in them reads both ways.
 */
export function spokenNumbers(text: string, language?: string): SpokenNumber[] {
  const code = languageCode(language);
  if (text.length > MAX_TEXT_LENGTH) return [{ words: "", readings: [] }];
  const all = tokens(text);
  if (all.length > MAX_TOKENS) return [{ words: "", readings: [] }];
  const found: SpokenNumber[] = [];
  let state = EMPTY;
  let words: string[] = [];
  let pending = "";
  let poisoned = false;
  // "5 un": an article beside a digit is not a number, unless a number word follows it.
  let articlesOnly = true;

  const flush = (): void => {
    if (poisoned) {
      if (!articlesOnly) found.push({ words: words.join(" "), readings: [] });
      poisoned = false;
    } else if (state.atoms > 0) {
      const own = String(valueOf(state));
      if (state.withoutCent !== undefined) {
        if (state.withoutCent !== null) found.push({ words: words.join(" "), readings: [state.withoutCent, own] });
      } else if (!state.onlyArticles) found.push({ words: words.join(" "), readings: [own] });
    }
    state = EMPTY;
    words = [];
    pending = "";
  };
  const unreadable = (): void => {
    found.push({ words: words.join(" "), readings: [] });
    state = EMPTY;
    words = [];
    pending = "";
  };

  const add = (atom: Atom, join: string, word: string): void => {
    if (atom.cent === true && state.atoms > 0) {
      const next = step(state, atom, join);
      if (next === null) {
        // "sixty-four cents": the coin, not a hundred.
        flush();
        return;
      }
      // Only a lone count can be a coin's number ("five cents"); after "mille" or "deux cent" it is French.
      const lone = state.last === "unit" && state.total === 0 && state.hundreds === 0;
      words.push(word);
      state = { ...next, withoutCent: lone ? (state.onlyArticles ? null : String(valueOf(state))) : undefined };
      return;
    }
    if (atom.cent === true && atom.plural === true) {
      flush();
      return;
    }
    const next = step(state, atom, join);
    if (next !== null) {
      words.push(word);
      state = next;
      return;
    }
    if (state.atoms === 0) return unreadable();
    const coordinated = pending !== "" || state.onlyArticles || state.withoutCent !== undefined;
    if (!coordinated) {
      unreadable();
      return;
    }
    flush();
    add(atom, "", word);
  };

  // A digit touching a number word on either side (joins like "and" between them do not part them) has a value
  // the digit guard cannot see. "64 cents" is a coin in English and 64 hundred in French. The whole run is unreadable.
  let sinceDigit = false;
  let afterCent = false;
  // A join between a digit and a number word, even a lone "one", ties them together ("5 and one").
  let joinedToDigit = false;
  for (const [at, token] of all.entries()) {
    if (token === "break") {
      flush();
      sinceDigit = false;
      afterCent = false;
      joinedToDigit = false;
      continue;
    }
    if (token === "digit") {
      if (!poisoned && (afterCent || (state.atoms > 0 && (!state.onlyArticles || pending !== "")))) {
        poisoned = true;
        articlesOnly = false;
      } else if (!poisoned) flush();
      sinceDigit = true;
      afterCent = false;
      joinedToDigit = false;
      continue;
    }
    const next = all[at + 1];
    const verb = code === "it" && token.word === "sei" && typeof next === "object" && SEI_VERB_NEXT.has(next.word);
    const resolved = verb ? null : resolve(token.word, code);
    if (resolved === null) {
      flush();
    } else if ("tooLong" in resolved) {
      flush();
      found.push({ words: token.word.slice(0, MAX_WORD_LENGTH), readings: [] });
    } else if ("join" in resolved) {
      if (state.atoms > 0 && !poisoned) pending = resolved.join;
      if (sinceDigit) joinedToDigit = true;
      continue;
    } else if (poisoned || sinceDigit) {
      if (!poisoned) {
        flush();
        poisoned = true;
        articlesOnly = !joinedToDigit;
      }
      articlesOnly = articlesOnly && resolved.atoms.every((atom) => atom.one === true);
      joinedToDigit = false;
      words.push(token.word);
      afterCent = resolved.atoms.at(-1)?.cent === true;
      sinceDigit = false;
      continue;
    } else {
      resolved.atoms.forEach((atom, index) => {
        const inner = resolved.joins[index] ?? "";
        const join = inner === "" ? pending : inner;
        add(atom, join, token.word);
        pending = "";
      });
      afterCent = resolved.atoms.at(-1)?.cent === true;
      sinceDigit = false;
      continue;
    }
    sinceDigit = false;
    afterCent = false;
    joinedToDigit = false;
  }
  flush();
  return found;
}

/**
 * Whether every number the text writes in words has a reading the record
 * supplied. A run with two readings ("five cents": five, or French 500)
 * passes only when every reading is held, so a guess is never the one accepted.
 * `isAllowed` takes a plain integer string ("64"), the same form
 * the digits are compared in.
 */
export function spokenNumbersAreAllowed(text: string, isAllowed: (value: string) => boolean, language?: string): boolean {
  return spokenNumbers(text, language).every((number) => number.readings.length > 0 && number.readings.every(isAllowed));
}
