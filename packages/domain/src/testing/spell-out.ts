/**
 * Whole numbers 0..9999 spelled out in each of Kin's seven languages, written
 * independently of the reader in `number-words.ts` so a test can check that
 * the two agree. Standard written forms only: one masculine spelling for
 * Arabic and Hebrew.
 */

export type Spell = (n: number) => string;

const split = (n: number) => ({ thousands: Math.floor(n / 1000), hundreds: Math.floor((n % 1000) / 100), rest: n % 100 });

const EN_UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

export const spellEnglish: Spell = (n) => {
  const { thousands, hundreds, rest } = split(n);
  if (n < 20) return EN_UNITS[n] ?? "";
  const tail = rest === 0 ? "" : rest < 20 ? (EN_UNITS[rest] ?? "") : `${EN_TENS[Math.floor(rest / 10)]}${rest % 10 === 0 ? "" : `-${EN_UNITS[rest % 10]}`}`;
  return [thousands > 0 ? `${spellEnglish(thousands)} thousand` : "", hundreds > 0 ? `${EN_UNITS[hundreds]} hundred` : "", tail].filter(Boolean).join(" ");
};

const FR_UNITS = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"];
const FR_TENS = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];

function frenchBelowHundred(n: number): string {
  if (n < 20) return FR_UNITS[n] ?? "";
  const tens = Math.floor(n / 10);
  const unit = n % 10;
  if (tens >= 7 && tens !== 8 && tens !== 9) return unit === 1 && tens === 7 ? "soixante et onze" : `soixante-${FR_UNITS[10 + unit]}`;
  if (tens === 8) return unit === 0 ? "quatre-vingts" : `quatre-vingt-${FR_UNITS[unit]}`;
  if (tens === 9) return `quatre-vingt-${FR_UNITS[10 + unit]}`;
  return unit === 0 ? (FR_TENS[tens] ?? "") : unit === 1 ? `${FR_TENS[tens]} et un` : `${FR_TENS[tens]}-${FR_UNITS[unit]}`;
}

export const spellFrench: Spell = (n) => {
  const { thousands, hundreds, rest } = split(n);
  if (n < 100) return frenchBelowHundred(n);
  const hundred = hundreds === 0 ? "" : hundreds === 1 ? "cent" : `${FR_UNITS[hundreds]} cent${rest === 0 ? "s" : ""}`;
  const thousand = thousands === 0 ? "" : thousands === 1 ? "mille" : `${spellFrench(thousands)} mille`;
  return [thousand, hundred, rest === 0 ? "" : frenchBelowHundred(rest)].filter(Boolean).join(" ");
};

const DE_UNITS = ["null", "ein", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf", "dreizehn", "vierzehn", "fünfzehn", "sechzehn", "siebzehn", "achtzehn", "neunzehn"];
const DE_TENS = ["", "", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig"];

const germanBelowHundred = (n: number): string => (n < 20 ? (DE_UNITS[n] ?? "") : `${n % 10 === 0 ? "" : `${DE_UNITS[n % 10]}und`}${DE_TENS[Math.floor(n / 10)]}`);

export const spellGerman: Spell = (n) => {
  const { thousands, hundreds, rest } = split(n);
  if (n < 100) return n === 1 ? "eins" : germanBelowHundred(n);
  return `${thousands > 0 ? `${DE_UNITS[thousands]}tausend` : ""}${hundreds > 0 ? `${DE_UNITS[hundreds]}hundert` : ""}${rest === 0 ? "" : rest === 1 ? "eins" : germanBelowHundred(rest)}`;
};

const IT_UNITS = ["zero", "uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove", "dieci", "undici", "dodici", "tredici", "quattordici", "quindici", "sedici", "diciassette", "diciotto", "diciannove"];
const IT_TENS = ["", "", "venti", "trenta", "quaranta", "cinquanta", "sessanta", "settanta", "ottanta", "novanta"];

function italianBelowHundred(n: number): string {
  if (n < 20) return IT_UNITS[n] ?? "";
  const tens = IT_TENS[Math.floor(n / 10)] ?? "";
  const unit = n % 10;
  if (unit === 0) return tens;
  const stem = unit === 1 || unit === 8 ? tens.slice(0, -1) : tens;
  return `${stem}${unit === 3 ? "tré" : IT_UNITS[unit]}`;
}

export const spellItalian: Spell = (n) => {
  const { thousands, hundreds, rest } = split(n);
  if (n < 100) return italianBelowHundred(n);
  const hundred = hundreds === 0 ? "" : `${hundreds === 1 ? "" : IT_UNITS[hundreds]}${rest >= 80 && rest < 90 ? "cent" : "cento"}`;
  const thousand = thousands === 0 ? "" : thousands === 1 ? "mille" : `${IT_UNITS[thousands]}mila`;
  return `${thousand}${hundred}${rest === 0 ? "" : italianBelowHundred(rest)}`;
};

const ES_UNITS = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const ES_TENS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const ES_HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

const spanishBelowHundred = (n: number): string => (n < 30 ? (ES_UNITS[n] ?? "") : `${ES_TENS[Math.floor(n / 10)]}${n % 10 === 0 ? "" : ` y ${ES_UNITS[n % 10]}`}`);

export const spellSpanish: Spell = (n) => {
  const { thousands, hundreds, rest } = split(n);
  if (n < 100) return spanishBelowHundred(n);
  const hundred = hundreds === 1 && rest === 0 ? "cien" : (ES_HUNDREDS[hundreds] ?? "");
  const thousand = thousands === 0 ? "" : thousands === 1 ? "mil" : `${ES_UNITS[thousands]} mil`;
  return [thousand, hundred, rest === 0 ? "" : spanishBelowHundred(rest)].filter(Boolean).join(" ");
};

const AR_UNITS = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"];
const AR_TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const AR_STEMS = ["", "", "", "ثلاث", "أربع", "خمس", "ست", "سبع", "ثماني", "تسع"];

function arabicBelowHundred(n: number): string {
  if (n < 10) return AR_UNITS[n] ?? "";
  if (n === 10) return "عشرة";
  if (n === 11) return "أحد عشر";
  if (n === 12) return "اثنا عشر";
  if (n < 20) return `${AR_UNITS[n - 10]} عشر`;
  return n % 10 === 0 ? (AR_TENS[n / 10] ?? "") : `${AR_UNITS[n % 10]} و${AR_TENS[Math.floor(n / 10)]}`;
}

export const spellArabic: Spell = (n) => {
  const { thousands, hundreds, rest } = split(n);
  if (n === 0) return "صفر";
  const hundred = hundreds === 0 ? "" : hundreds === 1 ? "مئة" : hundreds === 2 ? "مئتان" : `${AR_STEMS[hundreds]}مئة`;
  const thousand = thousands === 0 ? "" : thousands === 1 ? "ألف" : thousands === 2 ? "ألفان" : `${AR_UNITS[thousands]} آلاف`;
  return [thousand, hundred, rest === 0 ? "" : arabicBelowHundred(rest)].filter(Boolean).join(" و");
};

const HE_UNITS = ["", "אחד", "שניים", "שלושה", "ארבעה", "חמישה", "שישה", "שבעה", "שמונה", "תשעה"];
const HE_TENS = ["", "", "עשרים", "שלושים", "ארבעים", "חמישים", "שישים", "שבעים", "שמונים", "תשעים"];
const HE_FEMININE = ["", "", "", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע"];

function hebrewBelowHundred(n: number): string {
  if (n < 10) return HE_UNITS[n] ?? "";
  if (n === 10) return "עשרה";
  if (n === 12) return "שנים עשר";
  if (n < 20) return `${HE_UNITS[n - 10]} עשר`;
  return n % 10 === 0 ? (HE_TENS[n / 10] ?? "") : `${HE_TENS[Math.floor(n / 10)]} ו${HE_UNITS[n % 10]}`;
}

export const spellHebrew: Spell = (n) => {
  const { thousands, hundreds, rest } = split(n);
  if (n === 0) return "אפס";
  const hundred = hundreds === 0 ? "" : hundreds === 1 ? "מאה" : hundreds === 2 ? "מאתיים" : `${HE_FEMININE[hundreds]} מאות`;
  const thousand = thousands === 0 ? "" : thousands === 1 ? "אלף" : thousands === 2 ? "אלפיים" : `${HE_UNITS[thousands]} אלפים`;
  return [thousand, hundred, rest === 0 ? "" : hebrewBelowHundred(rest)].filter(Boolean).join(" ו");
};

export const SPELLERS = { en: spellEnglish, fr: spellFrench, de: spellGerman, it: spellItalian, es: spellSpanish, ar: spellArabic, he: spellHebrew } as const;
