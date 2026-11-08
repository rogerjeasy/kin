import { describe, expect, it } from "vitest";

import { spokenNumbers, spokenNumbersAreAllowed } from "./number-words.ts";
import { SPELLERS } from "./testing/spell-out.ts";

const values = (text: string) => spokenNumbers(text).map((number) => number.readings);
const allows = (text: string, ...held: string[]) => spokenNumbersAreAllowed(text, (value) => held.includes(value));

/** Sixty-four in each language, written the ways a model writes it. */
const SIXTY_FOUR = [
  "sixty-four", "sixty four", "Sixty-Four",
  "soixante-quatre", "soixante quatre",
  "vierundsechzig", "vier und sechzig",
  "sessantaquattro",
  "sesenta y cuatro",
  "أربعة وستون", "أربعة وستين",
  "שישים וארבע", "שישים וארבעה",
] as const;

describe("a number in words is accepted only for the value the record holds", () => {
  it.each(SIXTY_FOUR)("reads %s as 64", (words) => {
    expect(values(`It cost ${words} in all.`)).toEqual([["64"]]);
    expect(allows(`It cost ${words} in all.`, "64")).toBe(true);
    expect(allows(`It cost ${words} in all.`, "65")).toBe(false);
  });

  it("refuses a different value in each language", () => {
    for (const words of ["sixty-five", "sixty-four thousand", "six hundred forty", "soixante-cinq", "soixante-quatre mille", "fünfundsechzig", "vierundsechzigtausend", "sessantacinque", "sesenta y cinco", "sesenta y cuatro mil", "خمسة وستون", "אלף שישים וארבע"]) {
      expect(allows(words, "64"), words).toBe(false);
    }
  });
});

describe("compounds and irregular forms", () => {
  it.each([
    ["quatre-vingt-dix-sept", 97], ["quatre-vingts", 80], ["quatre-vingt-un", 81], ["soixante-dix", 70], ["soixante et onze", 71], ["vingt et un", 21], ["deux cent trois", 203], ["deux mille quinze", 2015], ["septante-cinq", 75], ["nonante", 90],
    ["einundzwanzig", 21], ["dreihunderteinundzwanzig", 321], ["zweitausend", 2000], ["eintausendzweihundert", 1200], ["dreißig", 30],
    ["ventuno", 21], ["centootto", 108], ["duemilacinquecento", 2500], ["milleduecento", 1200], ["ventitré", 23], ["diciassette", 17],
    ["veintiuno", 21], ["veintiún", 21], ["treinta y dos", 32], ["ciento uno", 101], ["quinientos", 500], ["mil quinientos", 1500], ["doscientas", 200],
    ["ثلاثمئة وخمسة", 305], ["ألفان", 2000], ["مئتان وأربعة وستون", 264], ["أحد عشر", 11], ["اثنا عشر", 12], ["ثلاثة آلاف", 3000],
    ["שלוש מאות", 300], ["אחד עשר", 11], ["מאתיים", 200], ["אלפיים", 2000], ["מאה ועשרים", 120],
    ["two hundred and three", 203], ["one hundred", 100], ["a thousand", 1000], ["one million two hundred thousand", 1_200_000],
  ] as const)("reads %s as %i", (words, value) => {
    expect(values(words)).toEqual([[String(value)]]);
  });

  it("reads a French hundreds as either a hundred or a coin, and a coin after anything else as a coin", () => {
    expect(values("deux cents euros")).toEqual([["2", "200"]]);
    expect(values("sixty-four cents")).toEqual([["64"]]);
    expect(values("one cent")).toEqual([]);
  });

  it("accepts a two-reading run only when every reading is held, so a guess is never the one accepted", () => {
    expect(allows("Il y a deux cents euros", "200")).toBe(false);
    expect(allows("Il y a deux cents euros", "2")).toBe(false);
    expect(allows("Il y a deux cents euros", "2", "200")).toBe(true);
    expect(allows("Il y a deux cents euros", "7")).toBe(false);
    expect(allows("It cost five cents", "5")).toBe(false);
    expect(allows("It cost five cents", "5", "500")).toBe(true);
  });
});

describe("what is not a number", () => {
  it("lets articles and ordinals through", () => {
    for (const text of ["a payment", "une facture", "ein Betrag", "eine Rechnung", "uno studio", "una fattura", "un pago", "one of them", "הוא אחד", "واحدة من", "the first, the seventh, 7th", "le premier, le septième", "am siebten", "il settimo", "el séptimo", "ראשון", "الأول"]) {
      expect(values(text), text).toEqual([]);
    }
  });

  it("counts an article beside a magnitude word as part of the number", () => {
    for (const [text, value] of [["twenty-one", "21"], ["vingt et un", "21"], ["einundzwanzig", "21"], ["ventuno", "21"], ["veintiún", "21"], ["ein Hundert", "100"], ["eine Million", "1000000"], ["un millón", "1000000"], ["ciento un", "101"]] as const) {
      expect(values(text), text).toEqual([[value]]);
    }
  });

  it("splits at punctuation, digits and other words", () => {
    expect(values("six, seven")).toEqual([["6"], ["7"]]);
    expect(values("six; seven")).toEqual([["6"], ["7"]]);
    expect(values("twelve and thirty")).toEqual([["12"], ["30"]]);
  });

  it("gives words it cannot value no reading, so they are refused", () => {
    expect(values("twelve hundred")).toEqual([[]]);
    expect(values("billion")).toEqual([[]]);
    expect(values("ملايين")).toEqual([[]]);
    expect(allows("twelve hundred", "12", "100", "1200")).toBe(false);
  });
});

describe("any number written out in a language reads back as itself", () => {
  for (const [language, spell] of Object.entries(SPELLERS)) {
    it(`${language}: 0..9999`, () => {
      for (let n = 0; n <= 9999; n += 1) {
        // The article "one" in its own right is not a number.
        if (n === 1) continue;
        const words = spell(n);
        const read = values(`Es ${words}.`);
        expect(read.length, `${n} as "${words}"`).toBe(1);
        // A French "cents" also reads as the English coin, listed first; the number itself is always the last reading.
        expect(read[0]?.at(-1), `${n} as "${words}"`).toBe(String(n));
        if (!/cents$/u.test(words)) expect(read[0], `${n} as "${words}"`).toEqual([String(n)]);
      }
    });
  }
});

describe("a long or adversarial input costs bounded time and fails closed", () => {
  const timed = (text: string) => {
    const start = Date.now();
    const result = spokenNumbers(text);
    return { result, ms: Date.now() - start };
  };

  it.each(["sechs", "drei", "ein", "und", "einund", "dreihundert", "zig", "zehn", "achtzehn", "neunzehn"])("finds no number in 400 characters of %s without exponential search", (atom) => {
    const { result, ms } = timed(atom.repeat(Math.ceil(400 / atom.length)).slice(0, 400));
    expect(ms).toBeLessThan(100);
    // Too long to be one number: refused, never read.
    expect(result.every((number) => number.readings.length === 0)).toBe(true);
    expect(spokenNumbersAreAllowed(atom.repeat(80), () => true)).toBe(false);
  });

  it("does not search every split of a word that cannot be read (achtzehn splits two ways; 50 of them then a stray letter)", () => {
    const { result, ms } = timed(`${"achtzehn".repeat(49)}x`);
    expect(ms).toBeLessThan(100);
    expect(result.every((number) => number.readings.length === 0)).toBe(true);
    // Short enough to search, and still exact.
    expect(timed(`${"achtzehn".repeat(10)}x`).result).toEqual([]);
  });

  it("still reads the longest real German number", () => {
    expect(values("neunhundertneunundneunzigmillionenneunhundertneunundneunzigtausendneunhundertneunundneunzig")).toEqual([["999999999"]]);
  });

  it("refuses 10,000 characters whole, quickly", () => {
    const { result, ms } = timed("sechs und drei ".repeat(700));
    expect(ms).toBeLessThan(100);
    expect(result).toEqual([{ words: "", readings: [] }]);
    expect(spokenNumbersAreAllowed("sechs ".repeat(2000), () => true)).toBe(false);
  });

  it("refuses more tokens than any real sentence holds", () => {
    expect(spokenNumbers("a ".repeat(1001))).toEqual([{ words: "", readings: [] }]);
  });
});

describe("digits joined to number words are a value the digit guard cannot see", () => {
  const refused = [
    ["en", "64 thousand dollars", "5 million", "3 hundred", "twenty 5", "ten 000"],
    ["fr", "64 mille euros", "5 millions", "3 mille trois", "vingt 5", "dix 000"],
    ["de", "64 tausend Euro", "5 Millionen", "3 hundert", "zwanzig 5", "zehn 000"],
    ["it", "64 mila euro", "5 milioni", "3 cento", "venti 5", "dieci 000"],
    ["es", "64 mil euros", "5 millones", "3 cien", "veinte 5", "diez 000"],
    ["ar", "64 ألف دولار", "5 مليون", "3 مئة", "عشرون 5", "عشرة 000"],
    ["he", "64 אלף דולר", "5 מיליון", "3 מאות", "עשרים 5", "עשרה 000"],
  ] as const;
  for (const [language, ...texts] of refused) {
    it(`${language}: refuses ${texts.join(" | ")} even when the digits are held`, () => {
      for (const text of texts) {
        const held = ["64", "5", "3", "20", "10", "0", "000", "100", "1000", "1000000", "64000"];
        expect(allows(text, ...held), text).toBe(false);
        expect(values(text).flat().length, text).toBe(0);
        expect(values(text).length, text).toBeGreaterThan(0);
      }
    });
  }

  it("swallows the rest of the run, so '64 thousand five hundred' is not read as 500", () => {
    expect(values("64 thousand five hundred")).toEqual([[]]);
  });

  it("leaves a digit beside an ordinary word alone, and a number in words beside digits after a break", () => {
    expect(values("64 dollars")).toEqual([]);
    expect(values("7 nov")).toEqual([]);
    expect(values("64 cents")).toEqual([]);
    expect(values("64 dollars, sixty-four")).toEqual([["64"]]);
    expect(allows("64 dollars, sixty-four", "64")).toBe(true);
    expect(allows("64 dollars (sixty-four)", "64")).toBe(true);
    expect(allows("a 5 un", "5")).toBe(true);
  });
});
