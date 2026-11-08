/** A number for a log line: enough to tell calls apart, not enough to call back. Same shape as the office line's. */
export function maskNumber(number: string | null): string | null {
  return number === null ? null : `${number.slice(0, 2)}${"*".repeat(Math.max(number.length - 4, 0))}${number.slice(-2)}`;
}

/** Whether text is a phone number in E.164 form: a plus, a country code that does not start with 0, at most 15 digits. */
export const E164 = /^\+[1-9][0-9]{6,14}$/;
