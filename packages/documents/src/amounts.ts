import { centsFromDecimal } from "@kin/domain";

/** Money tokens as people write them: 84, 84.50, 1,284.00, 1.284,00, 84,5. */
const TOKEN = /\d{1,3}(?:[.,\p{Zs}]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/gu;

/** The largest single amount Kin reads from a document: 1,000,000.00. Anything above is not a household bill. */
export const MAX_DOCUMENT_CENTS = 100_000_000;

function plainDecimal(token: string): string | null {
  const decimal = /[.,](\d{1,2})$/u.exec(token);
  const whole = (decimal === null ? token : token.slice(0, decimal.index)).replace(/\D/gu, "");
  return whole === "" ? null : `${whole}${decimal === null ? "" : `.${decimal[1]}`}`;
}

/** Every amount a document's text writes, in minor units, in the order written. */
export function amountsIn(text: string, currency: string): number[] {
  return [...text.matchAll(TOKEN)].flatMap((match) => {
    const decimal = plainDecimal(match[0]);
    if (decimal === null) return [];
    try {
      const cents = centsFromDecimal(decimal, currency);
      return cents > 0 && cents <= MAX_DOCUMENT_CENTS ? [cents] : [];
    } catch {
      return [];
    }
  });
}
