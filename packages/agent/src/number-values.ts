/**
 * Numbers read by value, for the number guard. A figure printed "86,40 $",
 * "86.40", "86 40"-style with a no-break space, or in Arabic-Indic digits is
 * the same amount whatever the language, and "64" is "64.00". Two different
 * amounts never share a value, so a changed digit or a moved decimal point
 * is still a different number.
 */

const SPACES = "\\u00a0\\u202f\\u2009\\u2007 ";
const MARKS = `[${SPACES}.,'\\u2019]`;
// Digits grouped three at a time by a dot, comma, apostrophe or space, or a plain run of digits, either with an
// optional decimal part. "86,40, 7" and "7 12" are two numbers: a group boundary is always exactly three digits.
const NUMBER = new RegExp(`\\d{1,3}(?:${MARKS}\\d{3})+(?!\\d)(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?`, "gu");
const MARK = new RegExp(MARKS, "gu");
const GROUP_SIZE = 3;

/** Digits of any script as ASCII digits, and the Arabic decimal and thousands marks as "." and ",". */
function asciiDigits(text: string): string {
  return text
    .replaceAll("٫", ".")
    .replaceAll("٬", ",")
    .replaceAll(/\p{Nd}/gu, (digit) => {
      const code = digit.codePointAt(0) ?? 0;
      let first = code;
      // Decimal digits sit in unbroken runs of ten, so the offset from the start of the run is the value.
      while (/\p{Nd}/u.test(String.fromCodePoint(first - 1))) first -= 1;
      return String((code - first) % 10);
    });
}

const canonical = (whole: string, fraction: string) => {
  const integer = whole.replace(/^0+(?=\d)/u, "");
  const decimals = fraction.replace(/0+$/u, "");
  return decimals === "" ? integer : `${integer}.${decimals}`;
};

/**
 * What one printed number can be worth. "1.000" is a thousand in German and
 * one in English, so it keeps both readings; "10.00" and "1.234,50" have one.
 */
function valuesOf(token: string): string[] {
  const parts = token.split(MARK);
  if (parts.length === 1) return [canonical(token, "")];
  const marks = token.match(MARK) ?? [];
  const tail = parts.at(-1) ?? "";
  const decimal = canonical(parts.slice(0, -1).join(""), tail);
  if (tail.length !== GROUP_SIZE) return [decimal];
  const grouped = canonical(parts.join(""), "");
  if (marks.length > 1) return new Set(marks).size === 1 ? [grouped] : [decimal];
  if (!/[.,]/u.test(marks[0] ?? "")) return [grouped];
  return parts[0]?.startsWith("0") === true ? [decimal] : [grouped, decimal];
}

/** One number as written (digits normalised to ASCII, spacing to a plain space) and the values it can have. */
export type WrittenNumber = { readonly written: string; readonly values: readonly string[] };

/** Every number written in the text. */
export function numbersIn(text: string): WrittenNumber[] {
  return [...asciiDigits(text).matchAll(NUMBER)].map((match) => ({ written: match[0].replaceAll(new RegExp(`[${SPACES}]`, "gu"), " "), values: valuesOf(match[0]) }));
}
