/**
 * An amount as a person typed it, ready for `centsFromDecimal`: a decimal comma
 * with one or two digits after it ("50,00") becomes a dot, as the hints in French,
 * German and other languages show it. The money core stays strict: "1,000" is
 * ambiguous, so it is left as typed and refused.
 */
export function typedAmount(text: string): string {
  return text.trim().replace(/^(\d+),(\d{1,2})$/u, "$1.$2");
}
